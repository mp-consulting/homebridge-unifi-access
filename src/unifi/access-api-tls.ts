/* Copyright(C) 2019-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 * Copyright(C) 2026, Mickael Palma / MP Consulting. All rights reserved.
 *
 * access-api-tls.ts: Trust-on-first-use TLS certificate pinning for connections to a UniFi Access controller.
 */
import type { HomebridgePluginLogging, Nullable } from '../lib/util.js';
import type { ClientRequestArgs } from 'node:http';
import type { Duplex } from 'node:stream';
import type { TLSSocket } from 'node:tls';
import https from 'node:https';

// Error code used when a controller presents a certificate that doesn't match the one we've pinned.
export const ACCESS_TLS_PIN_MISMATCH = 'ERR_ACCESS_TLS_PIN_MISMATCH';

// Options controlling trust-on-first-use certificate pinning. These only apply when strict TLS validation (verifyTls) is disabled.
//
// pinnedFingerprint:      SHA-256 fingerprint of the controller certificate we previously trusted. When absent, the first certificate we see is trusted and
//                         pinned.
// onFingerprint:          Called once when a new certificate fingerprint is pinned, so the caller can persist it.
// onFingerprintMismatch:  Called the first time a given mismatched fingerprint is seen, so the caller can explain how to reset it.
export interface AccessTlsPinOptions {

  onFingerprint?: (fingerprint: string) => void;
  onFingerprintMismatch?: (expected: string, actual: string) => void;
  pinnedFingerprint?: string;
}

// Normalize a SHA-256 fingerprint to the colon-separated, uppercase hex format Node uses for fingerprint256. Returns undefined for anything that isn't a valid
// SHA-256 fingerprint.
export function normalizeFingerprint(fingerprint?: string): string | undefined {

  const hex = (fingerprint ?? '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();

  if(hex.length !== 64) {

    return undefined;
  }

  return hex.match(/../g)?.join(':');
}

// Trust-on-first-use certificate pin for a single Access controller.
export class AccessTlsPin {

  private _fingerprint: string | undefined;
  private readonly log: HomebridgePluginLogging;
  private readonly options: AccessTlsPinOptions;
  private readonly reportedMismatches: Set<string>;

  constructor(log: HomebridgePluginLogging, options: AccessTlsPinOptions = {}) {

    this._fingerprint = normalizeFingerprint(options.pinnedFingerprint);
    this.log = log;
    this.options = options;
    this.reportedMismatches = new Set();
  }

  // Verify a certificate fingerprint against our pin, pinning it if we don't have one yet. Returns an error if the connection must be refused.
  public verify(host: string, presented: string | undefined): Nullable<Error> {

    const actual = normalizeFingerprint(presented);

    if(!actual) {

      return this.mismatchError(host, 'the controller did not present a usable TLS certificate');
    }

    // First contact - trust and pin this certificate.
    if(!this._fingerprint) {

      this._fingerprint = actual;
      this.log.info('Trusting and pinning the TLS certificate presented by %s (SHA-256 fingerprint: %s).', host, actual);
      this.options.onFingerprint?.(actual);

      return null;
    }

    if(actual === this._fingerprint) {

      return null;
    }

    // Only inform the user once per mismatched certificate so we don't flood the logs with each retry.
    if(!this.reportedMismatches.has(actual)) {

      this.reportedMismatches.add(actual);
      this.log.error('The TLS certificate presented by %s does not match the pinned certificate. Refusing to connect - no credentials have been sent. ' +
        'Expected SHA-256 fingerprint: %s. Received: %s. This can happen when the controller certificate is regenerated, or it may indicate that someone is ' +
        'intercepting your connection.', host, this._fingerprint, actual);
      this.options.onFingerprintMismatch?.(this._fingerprint, actual);
    }

    return this.mismatchError(host, 'certificate fingerprint ' + actual + ' does not match the pinned fingerprint ' + this._fingerprint);
  }

  // The currently pinned fingerprint, if any.
  public get fingerprint(): string | undefined {

    return this._fingerprint;
  }

  // Create a pin mismatch error.
  private mismatchError(host: string, reason: string): Error {

    return Object.assign(new Error('Refusing TLS connection to ' + host + ': ' + reason + '.'), { code: ACCESS_TLS_PIN_MISMATCH });
  }
}

// An HTTPS agent that verifies the controller's certificate against a trust-on-first-use pin before handing the socket to any request. Because the socket is
// only released to the HTTP layer once the TLS handshake completes and the pin is verified, no request data - login credentials and session cookies included -
// is ever written to an unverified connection.
export class AccessPinnedAgent extends https.Agent {

  private readonly pin: AccessTlsPin;

  constructor(pin: AccessTlsPin, options: https.AgentOptions = {}) {

    // Chain validation is replaced by our pin check - UniFi controllers ship with self-signed certificates.
    super({ ...options, rejectUnauthorized: false });

    this.pin = pin;
  }

  // Create the TLS connection asynchronously, only delivering it to the agent once the handshake has completed and the certificate matches our pin.
  public override createConnection(options: ClientRequestArgs, callback?: (err: Error | null, stream: Duplex) => void): Duplex | null | undefined {

    const socket = super.createConnection(options) as TLSSocket;

    // We should always have a callback when invoked by the agent. If not, we can't defer the socket, so refuse rather than hand out an unverified connection.
    if(!callback) {

      socket.destroy(new Error('Unable to verify the TLS certificate of the Access controller.'));

      return socket;
    }

    // Whichever of the handshake completing or failing happens first settles the connection. Later events are left to the HTTP layer.
    let settled = false;

    socket.once('error', (error: Error) => {

      if(settled) {

        return;
      }

      settled = true;
      callback(error, socket);
    });

    socket.once('secureConnect', () => {

      if(settled) {

        return;
      }

      settled = true;

      // A resumed TLS session can only be established with a server holding the keys from a session we previously verified, so it's implicitly trusted. We
      // still verify the certificate when it's available.
      const fingerprint = socket.getPeerCertificate().fingerprint256 as string | undefined;
      const error = (!fingerprint && socket.isSessionReused()) ? null : this.pin.verify(options.host ?? options.hostname ?? 'the Access controller', fingerprint);

      if(error) {

        socket.destroy();
        callback(error, socket);

        return;
      }

      callback(null, socket);
    });

    // Returning nothing tells the agent we'll deliver the socket through the callback.
    return undefined;
  }
}

// Create an HTTPS agent for communicating with an Access controller: strict certificate validation when verifyTls is enabled, and trust-on-first-use pinning
// otherwise.
export function createAccessAgent(verifyTls: boolean, pin: AccessTlsPin, options: https.AgentOptions = {}): https.Agent {

  return verifyTls ? new https.Agent({ ...options, rejectUnauthorized: true }) : new AccessPinnedAgent(pin, options);
}
