import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as servicediscovery from 'aws-cdk-lib/aws-servicediscovery';

import { Construct } from 'constructs';
import { Vpc, SubnetType, InstanceType, InstanceClass, InstanceSize, Peer, Port, SecurityGroup } from 'aws-cdk-lib/aws-ec2';
import { Cluster, FargateService, FargateTaskDefinition, ContainerImage } from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancer, ApplicationProtocol, ListenerAction } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';

export class GraphhopperStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, {
      ...props,
      env: {
        account: '863518450292', // Replace with your actual AWS account ID
        region: 'eu-west-2'      // Replace with your desired AWS region
      }
    });

    const vpc = ec2.Vpc.fromLookup(this, 'WheredatadVpc', {
      tags: {
        Name: 'wheredata-vpc-prod', // Replace with your actual VPC name tag
      },
    });

    // Create EFS file system for persistent storage
    const fileSystem = new efs.FileSystem(this, 'GraphhopperFileSystem', {
      vpc,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_14_DAYS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      securityGroup: new ec2.SecurityGroup(this, 'EfsSecurityGroup', {
        vpc,
        description: 'Security group for GraphHopper EFS',
        allowAllOutbound: true
      })
    });

    // Create ECS Cluster
    const cluster = new Cluster(this, 'GraphhopperCluster', {
      vpc,
    });

    // Create Service Discovery namespace
    const namespace = new servicediscovery.PrivateDnsNamespace(this, 'GraphhopperNamespace', {
      vpc,
      name: 'graphhopper.local',
      description: 'Private DNS namespace for GraphHopper service'
    });

    // ECS Task Role - Used by ECS tasks to access AWS resources such as databases, secrets, etc.
    const taskRole = new iam.Role(this, 'GraphhopperTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Define custom permissions required for Athena, RDS, ElastiCache, and CloudWatch Logs
    const customPolicy = new iam.Policy(this, 'GraphhopperCustomPolicy', {
        statements: [
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    "logs:CreateLogStream",
                    "logs:PutLogEvents",
                ],
                resources: ["*"]
            }),
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    "s3:GetObject",
                    "s3:ListBucket"
                ],
                resources: [
                    "arn:aws:s3:::example.wheredata.co",
                    "arn:aws:s3:::example.wheredata.co/*"
                ]
            }),
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    "elasticfilesystem:ClientMount",
                    "elasticfilesystem:ClientWrite",
                    "elasticfilesystem:ClientRootAccess"
                ],
                resources: [fileSystem.fileSystemArn]
            })
        ]
    });

    // Attach the custom policy to the ECS Task Role
    taskRole.attachInlinePolicy(customPolicy);

    // ECS Execution Role - Used by ECS to pull images from ECR and send logs to CloudWatch.
    const executionRole = new iam.Role(this, 'GraphhopperExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    executionRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ecr:GetAuthorizationToken',
          'ecr:BatchCheckLayerAvailability',
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchGetImage'
        ],
        resources: ['*']
      })
    );

    const GraphhopperSecrets = secretsmanager.Secret.fromSecretCompleteArn(this, 'GraphhopperSecretKey', 'arn:aws:secretsmanager:eu-west-2:863518450292:secret:prod/Graphhopper-74tP5s');

    const sslCertArn = GraphhopperSecrets.secretValueFromJson('SSL_CERT_ARN').unsafeUnwrap();

    // Check if ECR repository exists, if not create it
    let repository: ecr.IRepository;
    try {
      repository = ecr.Repository.fromRepositoryName(this, 'GraphhopperRepository', 'graphhopper');
    } catch (error) {
      repository = new ecr.Repository(this, 'GraphhopperRepository', {
        repositoryName: 'graphhopper',
        removalPolicy: cdk.RemovalPolicy.RETAIN
      });
    }

    // ECS Task Definition for Apache Graphhopper
    const taskDefinition = new FargateTaskDefinition(this, 'GraphhopperTaskDef', {
      memoryLimitMiB: 8192,  // 8GB
      cpu: 4096,  // 4 vCPU
      taskRole,
      executionRole,
    });

    repository.grantPull(taskDefinition.taskRole);
    
    // Create Log Group with explicit retention and permissions
    const logGroup = new logs.LogGroup(this, 'GraphhopperLogGroup', {
      logGroupName: '/ecs/graphhopper',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.RETAIN
    });

    // Grant permissions to the task execution role to write logs
    logGroup.grantWrite(taskDefinition.taskRole);

    // Create access point for the EFS
    const accessPoint = fileSystem.addAccessPoint('GraphhopperAccessPoint', {
      path: '/graphhopper-data',
      createAcl: {
        ownerGid: '1000',
        ownerUid: '1000',
        permissions: '755',
      },
      posixUser: {
        gid: '1000',
        uid: '1000',
      },
    });

    // Add Graphhopper container
    taskDefinition.addContainer('GraphhopperContainer', {
      image: ecs.ContainerImage.fromEcrRepository(repository, 'latest'),
      portMappings: [{ containerPort: 8989,
        hostPort: 8989,
        protocol: ecs.Protocol.TCP
      }],
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: 'graphhopper-ecs',
        logGroup: logGroup,
        mode: ecs.AwsLogDriverMode.NON_BLOCKING
      }),
      environment: {
        'ENV': 'production',
        'GH_DATA_DIR': '/data/default-gh',
        'GH_INPUT_FILE': '/data/great-britain-latest.pbf',
        'S3_BUCKET': 'example.wheredata.co',
        'S3_KEY': 'great-britain-latest.osm.pbf'
      },
      ulimits: [
        {
          name: ecs.UlimitName.NOFILE,
          softLimit: 65536,
          hardLimit: 1048576,
        }
      ],
      healthCheck: {
        command: ["CMD-SHELL", "curl -f http://localhost:8989/health || exit 1"],
        interval: cdk.Duration.seconds(30),
        retries: 3,
        timeout: cdk.Duration.seconds(30),
        startPeriod: cdk.Duration.seconds(600),
      }
    });

    // Add volume mount for persistent data
    taskDefinition.addVolume({
      name: 'graphhopper-data',
      efsVolumeConfiguration: {
        fileSystemId: fileSystem.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: accessPoint.accessPointId,
          iam: 'ENABLED'
        },
        rootDirectory: '/'
      }
    });

    // Mount the volume to the container
    taskDefinition.defaultContainer?.addMountPoints({
      containerPath: '/data',
      sourceVolume: 'graphhopper-data',
      readOnly: false
    });

    const ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc,
      allowAllOutbound: true,
    });

    // Allow EFS access from ECS tasks
    fileSystem.connections.allowFrom(ecsSecurityGroup, Port.tcp(2049));

    // ECS Fargate Service with Service Discovery
    const service = new FargateService(this, 'GraphhopperService', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      securityGroups: [ecsSecurityGroup],
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      cloudMapOptions: {
        name: 'graphhopper',
        cloudMapNamespace: namespace,
        dnsRecordType: servicediscovery.DnsRecordType.A,
        dnsTtl: cdk.Duration.seconds(30)
      }
    });


    // Application Load Balancer
    const loadBalancer = new ApplicationLoadBalancer(this, 'GraphhopperALB', {
      vpc,
      internetFacing: true,
    });

    const certificate = acm.Certificate.fromCertificateArn(this, 'Certificate', sslCertArn);

    // Create the HTTPS listener on port 443 and attach the certificate
    const httpsListener = loadBalancer.addListener('HttpsListener', {
      port: 443,
      certificates: [certificate]
    });

    // Create an HTTP listener on port 80 and redirect traffic to HTTPS
    const httpListener = loadBalancer.addListener('HttpListener', {
      port: 80,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: 'HTTPS',
        port: '443',
        permanent: true // Sets the HTTP 301 redirect response
      })
    });

    httpsListener.addTargets('GraphhopperTargets', {
      port: 8989,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(60),
        port: '8989',  // Updated to match container port
      },
    });

    // Allow traffic from ALB to ECS service
    service.connections.allowFrom(loadBalancer, Port.tcp(8989));

  }
}

const app = new cdk.App();
new GraphhopperStack(app, 'GraphhopperStack');
