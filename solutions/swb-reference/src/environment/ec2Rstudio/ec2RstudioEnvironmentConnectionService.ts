/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */

import * as crypto from 'crypto';

import { AwsService } from '@aws/workbench-core-base';
import {
  EnvironmentConnectionService,
  EnvironmentConnectionLinkPlaceholder
} from '@aws/workbench-core-environments';

import NodeRSA = require('node-rsa');

export default class EC2RstudioEnvironmentConnectionService implements EnvironmentConnectionService {
  private _envType: string = 'ec2Rstudio';
  /**
   * Get credentials for connecting to the environment
   */
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  public async getAuthCreds(instanceName: string, context?: any): Promise<any> {
    const authorizedUrl = await this.getRStudioUrl(instanceName, context);
    return { url: authorizedUrl };
  }

  /**
   * Instructions for connecting to the workspace that can be shown verbatim in the UI
   */
  public getConnectionInstruction(): Promise<string> {
    // "url" is the key of the response returned by the method `getAuthCreds`
    const link: EnvironmentConnectionLinkPlaceholder = {
      type: 'link',
      hrefKey: 'url',
      text: 'Rstudio URL'
    };
    return Promise.resolve(`To access Rstudio, open #${JSON.stringify(link)}`);
  }

  /**
   * Get Rstudio connection URL by reading public key from SSM parameter.
   */
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  public async getRStudioUrl(instanceId: string, context?: any): Promise<string> {
    const jwtSecret = process.env.JWT_SECRET!;
    console.log(`JWT Secret - ${jwtSecret}`);
    const secureConnectionMetadata = JSON.parse(process.env.SECURE_CONNECTION_METADATA!);
    const { partnerDomain } = secureConnectionMetadata;
    const envId = context.envId;

    // const authorizedUrl = `https://${this._envType}-${envId}.${partnerDomain}`;
    const rstudioSignInUrl = `https://${this._envType}-${envId}.${partnerDomain}/auth-do-sign-in`;
    const hash = crypto.createHash('sha256');
    const username = 'ec2-user';
    const password = hash.update(`${instanceId}${jwtSecret}`).digest('hex');
    const credentials = `${username}\n${password}`;
    const publicKey = await this.getRstudioPublicKey(instanceId, context);
    const [exponent, modulus] = publicKey.split(':', 2);
    const exponentBuffer = Buffer.from(exponent, 'hex');
    const modulusBuffer = Buffer.from(modulus, 'hex');
    const key = new NodeRSA();
    const publicKeyObject = key.importKey({ n: modulusBuffer, e: exponentBuffer }, 'components-public');
    const payloadBuffer = Buffer.from(credentials);
    const result = crypto.publicEncrypt(
      { key: publicKeyObject.exportKey('public'), padding: crypto.constants.RSA_PKCS1_PADDING },
      payloadBuffer
    );
    const params = { v: result.toString('base64') };
    const authorizedUrl = `${rstudioSignInUrl}?${new URLSearchParams(params)}`;
    return authorizedUrl;
  }

  /**
   * Get Rstudio public key from SSM parameter.
   */
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  public async getRstudioPublicKey(instanceId: string, context?: any): Promise<string> {
    const region = process.env.AWS_REGION!;
    const awsService = new AwsService({ region });
    const hostingAccountAwsService = await awsService.getAwsServiceForRole({
      roleArn: context.roleArn,
      roleSessionName: `RstudioConnect-${Date.now()}`,
      externalId: context.externalId,
      region
    });

    const response = await hostingAccountAwsService.clients.ssm.getParameter({
      Name: `/rstudio/publickey/sc-environments/ec2-instance/${instanceId}`,
      WithDecryption: true
    });
    return response.Parameter!.Value!;
  }
}
