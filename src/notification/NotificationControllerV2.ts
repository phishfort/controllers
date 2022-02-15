/* eslint-disable prettier/prettier */
import type { Patch } from 'immer';

import { BaseController } from '../BaseControllerV2';

import type { RestrictedControllerMessenger } from '../ControllerMessenger';

/**
 * @type NotificationState
 * @property requests - Object containing number of requests in a given interval and a timeout id
 */
export type NotificationState = {
  requests: Record<string, NotificationRequests>;
};

interface NotificationRequests {
  count: number;
  timeoutId?: NodeJS.Timeout;
}

export enum NotificationType {
  native = 'native',
}

export interface NotificationArgs {
  /**
   * @todo
   */
  type: NotificationType;

  /**
   * @todo
   */
  message: string;
}

const name = 'NotificationControllerV2';

export type NotificationStateChange = {
  type: `${typeof name}:stateChange`;
  payload: [NotificationState, Patch[]];
};

export type GetNotificationState = {
  type: `${typeof name}:getState`;
  handler: () => NotificationState;
};

type NotificationMessenger = RestrictedControllerMessenger<
  typeof name,
  GetNotificationState,
  NotificationStateChange,
  never,
  never
>;

const metadata = {
  requests: { persist: false, anonymous: false },
};

const defaultState = {
  requests: {},
};

/**
 * Controller that handles showing notifications to the user and rate limiting origins
 */
export class NotificationController extends BaseController<
  typeof name,
  NotificationState,
  NotificationMessenger
> {
  private platform;

  private rateLimitTimeout;

  private rateLimitCount;

  /**
   * Creates a NotificationController instance.
   *
   * @param options - Constructor options.
   * @param options.messenger - A reference to the messaging system.
   * @param options.state - Initial state to set on this controller.
   * @param options.platform - The ExtensionPlatform defined in the extension
   * @param options.rateLimitTimeout The time window in which the rate limit is applied
   * @param options.rateLimitCount The amount of notifications an origin can show in the rate limit time window
   */
  constructor({
    rateLimitTimeout = 5000,
    rateLimitCount = 3,
    messenger,
    state,
    platform,
  }: {
    rateLimitTimeout?: number;
    rateLimitCount?: number;
    messenger: NotificationMessenger;
    state?: Partial<NotificationState>;
    platform: any; // ExtensionPlatform from extension
  }) {
    super({
      name,
      metadata,
      messenger,
      state: { ...defaultState, ...state },
    });
    this.platform = platform;
    this.rateLimitTimeout = rateLimitTimeout;
    this.rateLimitCount = rateLimitCount;
  }

  /**
   * Shows a notification if origin is not rate-limited
   *
   * @param origin The origin trying to send a notification
   * @param args Notification arguments, containing the notification message etc.
   * @returns False if rate-limited, true if not
   */
  show(origin: string, args: NotificationArgs) {
    if (this._isRateLimited(origin)) {
      return false;
    }
    this._recordRequest(origin);

    switch (args.type) {
      case NotificationType.native:
        this.platform._showNotifiction(origin, args.message);
        break;
      default:
        throw new Error('Invalid notification type');
    }

    return true;
  }

  _isRateLimited(origin: string) {
    return this.state.requests[origin]?.count >= this.rateLimitCount;
  }

  _recordRequest(origin: string) {
    this.update((state) => {
      if (!(origin in state.requests)) {
        state.requests[origin] = {
          count: 1,
          timeoutId: setTimeout(
            () => this._resetRequestCount(origin),
            this.rateLimitTimeout,
          ),
        };
      } else {
        state.requests[origin].count += 1;
      }
    });
  }

  _resetRequestCount(origin: string) {
    this.update((state) => {
      state.requests[origin].count = 0;
      state.requests[origin].timeoutId = undefined;
    });
  }
}
