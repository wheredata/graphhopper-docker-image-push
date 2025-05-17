import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

import { Construct } from 'constructs';
import { Vpc, SubnetType, InstanceType, InstanceClass, InstanceSize, Peer, Port, SecurityGroup } from 'aws-cdk-lib/aws-ec2';
import { Cluster, FargateService, FargateTaskDefinition, ContainerImage } from 'aws-cdk-lib/aws-ecs';
import { ApplicationLoadBalancer, ApplicationProtocol, ListenerAction } from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { PublicHostedZone, ARecord, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { LoadBalancerTarget } from 'aws-cdk-lib/aws-route53-targets';
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

const vpc = ec2.Vpc.fromLookup(this, 'WheredatadVpc', {
  tags: {
    Name: 'wheredata-vpc-prod', // Replace with your actual VPC name tag
  },
});

// Create ECS Cluster
const cluster = new Cluster(this, 'GraphhopperCluster', {
  vpc,
});

const repository = ecr.Repository.fromRepositoryName(this, 'GraphhopperRepository', 'Graphhopper');

// ECS Task Definition for Apache Graphhopper
const taskDefinition = new FargateTaskDefinition(this, 'GraphhopperTaskDef', {
  memoryLimitMiB: 8192,
  cpu: 2048,
  taskRole,
  executionRole,
});

repository.grantPull(taskDefinition.taskRole);
    
const logGroupName = '/ecs/graphhopper';
let logGroup;

try {
  // Try to import the existing log group
  logGroup = logs.LogGroup.fromLogGroupName(this, 'GraphhopperLogGroup', logGroupName);
} catch (error) {
  // If the log group doesn't exist, create a new one
  logGroup = new logs.LogGroup(this, 'GraphhopperLogGroup', {
    logGroupName: logGroupName,
    retention: logs.RetentionDays.ONE_WEEK,
  });
}

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
  }),
  environment: {
    'ENV': 'production',
   },
  entryPoint: ['sh', '-c'],
  command: [
    "/graphhopper/graphhopper.sh && tail -f /dev/null"
  ],
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
    timeout: cdk.Duration.seconds(5),
    startPeriod: cdk.Duration.seconds(3),
  }
});

const ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
  vpc,
  allowAllOutbound: true,
});

// ECS Fargate Service
const service = new FargateService(this, 'GraphhopperService', {
  cluster,
  taskDefinition,
  desiredCount: 1,
  securityGroups: [ecsSecurityGroup],
  minHealthyPercent: 100,
  maxHealthyPercent: 200
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
  port: 8089,
  protocol: elbv2.ApplicationProtocol.HTTP,
  targets: [service],
  healthCheck: {
    path: '/health',
    interval: cdk.Duration.seconds(60),
    port: '8089',  // Explicitly set the health check port
  },
});

// Allow traffic from ALB to ECS service
service.connections.allowFrom(loadBalancer, Port.tcp(8089));

const zone = PublicHostedZone.fromLookup(this, 'HostedZone', {
  domainName: 'wheredata.co',
});

new ARecord(this, 'GraphhopperAliasRecord', {
  zone,
  recordName: 'graphhopper',
  target: RecordTarget.fromAlias(new LoadBalancerTarget(loadBalancer)),
});

}
}

const app = new cdk.App();
new GraphhopperStack(app, 'GraphhopperStack');
