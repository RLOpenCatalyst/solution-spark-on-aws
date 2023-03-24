/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import { generateRouter, ApiRouteConfig } from '@aws/swb-app';
import { AuditService, BaseAuditPlugin } from '@aws/workbench-core-audit';
import { AwsService, AuditLogger } from '@aws/workbench-core-base';
import {
  DataSetService,
  S3DataSetStoragePlugin,
  DdbDataSetMetadataPlugin
} from '@aws/workbench-core-datasets';
import {
  HostingAccountService,
  EnvironmentService,
  EnvironmentTypeService,
  EnvironmentTypeConfigService,
  ProjectService
} from '@aws/workbench-core-environments';
import { LoggingService } from '@aws/workbench-core-logging';
import { Express } from 'express';
import ec2JupyterLabEnvironmentConnectionService from './environment/ec2JupyterLab/ec2JupyterLabEnvironmentConnectionService';
import ec2JupyterLabEnvironmentLifecycleService from './environment/ec2JupyterLab/ec2JupyterLabEnvironmentLifecycleService';
import ec2RstudioEnvironmentConnectionService from './environment/ec2Rstudio/ec2RstudioEnvironmentConnectionService';
import ec2RstudioEnvironmentLifecycleService from './environment/ec2Rstudio/ec2RstudioEnvironmentLifecycleService';
import ec2Rstudio421EnvironmentConnectionService from './environment/ec2Rstudio421/ec2Rstudio421EnvironmentConnectionService';
import ec2Rstudio421EnvironmentLifecycleService from './environment/ec2Rstudio421/ec2Rstudio421EnvironmentLifecycleService';
import ec2SpyderEnvironmentConnectionService from './environment/ec2Spyder/ec2SpyderEnvironmentConnectionService';
import ec2SpyderEnvironmentLifecycleService from './environment/ec2Spyder/ec2SpyderEnvironmentLifecycleService';
import SagemakerNotebookEnvironmentConnectionService from './environment/sagemakerNotebook/sagemakerNotebookEnvironmentConnectionService';
import SagemakerNotebookEnvironmentLifecycleService from './environment/sagemakerNotebook/sagemakerNotebookEnvironmentLifecycleService';

const logger: LoggingService = new LoggingService();
const aws: AwsService = new AwsService({
  region: process.env.AWS_REGION!,
  ddbTableName: process.env.STACK_NAME!
});

const apiRouteConfig: ApiRouteConfig = {
  routes: [
    {
      path: '/foo',
      serviceAction: 'launch',
      httpMethod: 'post',
      service: new SagemakerNotebookEnvironmentLifecycleService()
    }
  ],
  environments: {
    sagemakerNotebook: {
      lifecycle: new SagemakerNotebookEnvironmentLifecycleService(),
      connection: new SagemakerNotebookEnvironmentConnectionService()
    },
    ec2Rstudio: {
      lifecycle: new ec2RstudioEnvironmentLifecycleService(),
      connection: new ec2RstudioEnvironmentConnectionService()
    },
    ec2Rstudio421: {
      lifecycle: new ec2Rstudio421EnvironmentLifecycleService(),
      connection: new ec2Rstudio421EnvironmentConnectionService()
    },
    ec2JupyterLab: {
      lifecycle: new ec2JupyterLabEnvironmentLifecycleService(),
      connection: new ec2JupyterLabEnvironmentConnectionService()
    },
    ec2Spyder: {
      lifecycle: new ec2SpyderEnvironmentLifecycleService(),
      connection: new ec2SpyderEnvironmentConnectionService()
    }

    // Add your environment types here as follows:
    // <newEnvTypeName>: {
    //   lifecycle: new <newEnvTypeName>EnvironmentLifecycleService(),
    //   connection: new <newEnvTypeName>EnvironmentConnectionService()
    // }
  },
  account: new HostingAccountService(),
  environmentService: new EnvironmentService({
    TABLE_NAME: process.env.STACK_NAME!
  }),
  dataSetService: new DataSetService(
    new AuditService(new BaseAuditPlugin(new AuditLogger(logger))),
    logger,
    new DdbDataSetMetadataPlugin(aws, 'DATASET', 'ENDPOINT')
  ),
  dataSetsStoragePlugin: new S3DataSetStoragePlugin(aws),
  allowedOrigins: JSON.parse(process.env.ALLOWED_ORIGINS || '[]'),
  environmentTypeService: new EnvironmentTypeService({
    TABLE_NAME: process.env.STACK_NAME!
  }),
  environmentTypeConfigService: new EnvironmentTypeConfigService({
    TABLE_NAME: process.env.STACK_NAME!
  }),
  projectService: new ProjectService({
    TABLE_NAME: process.env.STACK_NAME!
  })
};

const backendAPIApp: Express = generateRouter(apiRouteConfig);

export default backendAPIApp;
