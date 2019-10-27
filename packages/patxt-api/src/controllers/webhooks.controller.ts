import { repository } from '@loopback/repository';
import { get, param, post, requestBody } from '@loopback/rest';
import axios from 'axios';

import { UserRepository } from '../repositories';
import { formatToE164PhoneNumber } from '../utils';

const GLOBE_APP_SHORT_CODE_SUFFIX = process.env.GLOBE_APP_SHORT_CODE_SUFFIX;

export class WebhooksController {
  constructor(
    @repository(UserRepository) private userRepository: UserRepository,
  ) {}

  @get('/webhooks/globelabsapi/redirecturi', {
    parameters: [
      {
        name: 'access_token',
        schema: { type: 'string' },
        in: 'query',
      },
      {
        name: 'subscriber_number',
        schema: { type: 'string' },
        in: 'query',
      },
    ],
    responses: {
      '201': {
        description: 'Globe Labs API - Redirect URI webhook response (Opt-in)',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  })
  async redirectUriOptInWebhook(
    @param.query.string('access_token') accessCode: string,
    @param.query.string('subscriber_number') subscriberNumber: string,
  ) {
    const formattedPhoneNumber = formatToE164PhoneNumber(subscriberNumber);

    const newUserRecord = await this.userRepository.create({
      phoneNumber: formattedPhoneNumber,
      smsAccessToken: accessCode,
      createdAt: new Date().toJSON(),
      modifiedAt: new Date().toJSON(),
    });

    console.log('Created user record: ', newUserRecord);

    return {
      success: true,
    };
  }

  @post('/webhooks/globelabsapi/notifyuri', {
    parameters: [
      { name: 'access_token', schema: { type: 'string' }, in: 'query' },
    ],

    responses: {
      '201': {
        description: 'Globe Labs API - Notify URI webhook response',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  })
  async notifyUriWebhook(@requestBody({
    description: 'data',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            inboundSMSMessageList: {
              type: 'object',
              properties: {
                inboundSMSMessage: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      dateTime: { type: 'string' },
                      destinationAddress: { type: 'string' },
                      messageId: { nullable: true, type: 'string' },
                      message: { type: 'string' },
                      resourceURL: { nullable: true, type: 'string' },
                      senderAddress: { type: 'string' },
                    },
                  },
                },
                numberOfMessagesInThisBatch: { type: 'number' },
                resourceURL: { nullable: true, type: 'string' },
                totalNumberOfPendingMessages: {
                  nullable: true,
                  type: 'string',
                },
              },
            },
          },
        },
      },
    },
    required: true,
  })
  requestBody: {
    inboundSMSMessageList: {
      inboundSMSMessage: Array<{
        dateTime: string; // Fri Nov 22 2013 12:12:13 GMT+0000 (UTC)
        destinationAddress: string; // tel:21581234
        messageId: string | null;
        message: string;
        resourceURL: string | null;
        senderAddress: string; // tel:+639171234567
      }>;
      numberOfMessagesInThisBatch: number;
      resourceURL: string | null;
      totalNumberofPendingMessages: number | null;
    };
  }) {
    const {
      inboundSMSMessageList: { inboundSMSMessage },
    } = requestBody;

    await Promise.all(
      inboundSMSMessage.map(async ({ message: inbountMessage }) => {
        const [
          action,
          recipientPhoneNumber,
          ...messageParts
        ] = inbountMessage.split(' ');

        const formattedDestinationPhoneNumber = formatToE164PhoneNumber(
          recipientPhoneNumber,
        );

        const recipientUser = await this.userRepository.findOne({
          where: {
            phoneNumber: formattedDestinationPhoneNumber,
          },
        });

        if (action.toLowerCase() === 'send') {
          if (!recipientUser) {
            // TODO: Handle gracefully
            return;
          }

          const { smsAccessToken } = recipientUser;

          await axios.post(
            `https://devapi.globelabs.com.ph/smsmessaging/v1/outbound/${GLOBE_APP_SHORT_CODE_SUFFIX}/requests?access_token=${smsAccessToken}`,
            {
              outboundSMSMessageRequest: {
                address: formattedDestinationPhoneNumber,
                // TODO: Should be auto-generated and unique for each message
                clientCorrelator: '123456',
                outboundSMSTextMessage: { message: messageParts.join(' ') },
                senderAddress: GLOBE_APP_SHORT_CODE_SUFFIX,
              },
            },
          );

          console.log('Message sent to: ', formattedDestinationPhoneNumber);

          // TODO: Log/Save message sent
        }
      }),
    );

    return {
      success: true,
    };
  }
}
