import { toASCII } from 'punycode/';
import DEFAULT_PHISHING_RESPONSE from 'eth-phishing-detect/src/config.json';
import PhishingDetector from 'eth-phishing-detect/src/detector';
import { BaseController, BaseConfig, BaseState } from '../BaseController';
import { safelyExecute } from '../util';

/**
 * @type EthPhishingResponse
 *
 * Configuration response from the eth-phishing-detect package
 * consisting of approved and unapproved website origins
 * @property blacklist - List of unapproved origins
 * @property fuzzylist - List of fuzzy-matched unapproved origins
 * @property tolerance - Fuzzy match tolerance level
 * @property version - Version number of this configuration
 * @property whitelist - List of approved origins
 */
export interface EthPhishingResponse {
  blacklist: string[];
  fuzzylist: string[];
  tolerance: number;
  version: number;
  whitelist: string[];
}

/**
 * @type EthPhishingDetectConfig
 *
 * Interface defining expected input to PhishingDetector.
 * @property allowlist - List of approved origins (legacy naming "whitelist")
 * @property blocklist - List of unapproved origins (legacy naming "blacklist")
 * @property fuzzylist - List of fuzzy-matched unapproved origins
 * @property tolerance - Fuzzy match tolerance level
 */
export interface EthPhishingDetectConfig {
  allowlist: string[];
  blocklist: string[];
  fuzzylist: string[];
  tolerance: number;
  name: string;
  version: number;
}

/**
 * @type PhishingConfig
 *
 * Phishing controller configuration
 * @property interval - Polling interval used to fetch new block / approve lists
 */
export interface PhishingConfig extends BaseConfig {
  interval: number;
}

/**
 * @type PhishingState
 *
 * Phishing controller state
 * @property phishing - eth-phishing-detect configuration
 * @property whitelist - array of temporarily-approved origins
 */
export interface PhishingState extends BaseState {
  phishing: EthPhishingDetectConfig[];
  whitelist: string[];
}

/**
 * Controller that passively polls on a set interval for approved and unapproved website origins
 */
export class PhishingController extends BaseController<
  PhishingConfig,
  PhishingState
> {
  private configUrlMetaMask =
    'https://cdn.jsdelivr.net/gh/MetaMask/eth-phishing-detect@master/src/config.json';

  private configUrlPhishFortHotlist = `https://cdn.jsdelivr.net/gh/phishfort/phishfort-lists@master/blacklists/hotlist.json`;

  private detector: any;

  private handle?: NodeJS.Timer;

  /**
   * Name of this controller used during composition
   */
  override name = 'PhishingController';

  /**
   * Creates a PhishingController instance.
   *
   * @param config - Initial options used to configure this controller.
   * @param state - Initial state to set on this controller.
   */
  constructor(
    config?: Partial<PhishingConfig>,
    state?: Partial<PhishingState>,
  ) {
    super(config, state);
    this.defaultConfig = { interval: 60 * 60 * 1000 };
    this.defaultState = {
      phishing: DEFAULT_PHISHING_RESPONSE,
      whitelist: [],
    };
    this.detector = new PhishingDetector(this.defaultState.phishing);
    this.initialize();
    this.poll();
  }

  /**
   * Starts a new polling interval.
   *
   * @param interval - Polling interval used to fetch new approval lists.
   */
  async poll(interval?: number): Promise<void> {
    interval && this.configure({ interval }, false, false);
    this.handle && clearTimeout(this.handle);
    await safelyExecute(() => this.updatePhishingLists());
    this.handle = setTimeout(() => {
      this.poll(this.config.interval);
    }, this.config.interval);
  }

  /**
   * Determines if a given origin is unapproved.
   *
   * @param origin - Domain origin of a website.
   * @returns Whether the origin is an unapproved origin.
   */
  test(origin: string): boolean {
    const punycodeOrigin = toASCII(origin);
    if (this.state.whitelist.indexOf(punycodeOrigin) !== -1) {
      return false;
    }
    return this.detector.check(punycodeOrigin).result;
  }

  /**
   * Temporarily marks a given origin as approved.
   *
   * @param origin - The origin to mark as approved.
   */
  bypass(origin: string) {
    const punycodeOrigin = toASCII(origin);
    const { whitelist } = this.state;
    if (whitelist.indexOf(punycodeOrigin) !== -1) {
      return;
    }
    this.update({ whitelist: [...whitelist, punycodeOrigin] });
  }

  /**
   * Updates lists of approved and unapproved website origins.
   */
  async updatePhishingLists() {
    if (this.disabled) {
      return;
    }

    const configs: EthPhishingDetectConfig[] = [];

    const [metamaskConfigLegacy, phishfortHotlist] = await Promise.all([
      await this.queryConfig<EthPhishingResponse>(this.configUrlMetaMask),
      await this.queryConfig<string[]>(this.configUrlPhishFortHotlist),
    ]);

    // Correctly shaping MetaMask config.
    const metamaskConfig: EthPhishingDetectConfig = {
      allowlist: metamaskConfigLegacy ? metamaskConfigLegacy.whitelist : [],
      blocklist: metamaskConfigLegacy ? metamaskConfigLegacy.blacklist : [],
      fuzzylist: metamaskConfigLegacy ? metamaskConfigLegacy.fuzzylist : [],
      tolerance: metamaskConfigLegacy ? metamaskConfigLegacy.tolerance : 0,
      name: `MetaMask`,
      version: metamaskConfigLegacy ? metamaskConfigLegacy.version : 0,
    };
    if (metamaskConfigLegacy) {
      configs.push(metamaskConfig);
    }

    // Correctly shaping PhishFort config.
    const phishfortConfig: EthPhishingDetectConfig = {
      allowlist: [],
      blocklist: (phishfortHotlist || []).filter(i => !metamaskConfig.blocklist.includes(i)), // Removal of duplicates.
      fuzzylist: [],
      tolerance: 0,
      name: `PhishFort`,
      version: 1
    };
    if (phishfortHotlist) {
      configs.push(phishfortConfig);
    }

    // Do not update if all configs are unavailable.
    if (!configs.length) {
      return;
    }

    this.detector = new PhishingDetector(configs);
    this.update({
      phishing: configs,
    });
  }

  private async queryConfig<ResponseType>(
    input: RequestInfo,
  ): Promise<ResponseType | null> {
    const response = await fetch(input, { cache: 'no-cache' });

    switch (response.status) {
      case 200: {
        return await response.json();
      }

      default: {
        return null;
      }
    }
  }
}

export default PhishingController;
