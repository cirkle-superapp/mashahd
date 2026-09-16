/**
 * SmsPort — customer-funded SMS abstraction.
 *
 * Per master spec §8-11:
 *   - SMS is NOT a free platform service — it's customer-funded.
 *   - SMS must be a provider-neutral abstraction (SmsPort).
 *   - SMS can only be triggered with explicit customer consent + billing authorization.
 *   - SMS and Email have independent quotas, permissions, cost models, retry policies.
 *
 * Authorization state machine (§10):
 *   NOT_REQUESTED → QUOTED → AUTHORIZED → QUEUED → SUBMITTED → DELIVERED
 *                                                        ↓
 *                                                     FAILED
 *   CHARGE_PENDING → CHARGED → (REFUNDED | CANCELLED)
 *
 * The actual SMS provider is configured later (Twilio, Vonage, etc.).
 * The platform NEVER pays SMS charges out of its infrastructure budget.
 */

export type SmsAuthorizationState =
  | "NOT_REQUESTED"
  | "QUOTED"
  | "AUTHORIZED"
  | "QUEUED"
  | "SUBMITTED"
  | "DELIVERED"
  | "FAILED"
  | "CHARGE_PENDING"
  | "CHARGED"
  | "REFUNDED"
  | "CANCELLED";

export interface SmsRequest {
  sms_request_id: string;
  customer_id: string;
  user_id: string;
  purpose: string; // e.g. "OTP", "shipment_notification"
  destination: string; // phone number (E.164)
  provider?: string; // e.g. "twilio" (configured later)
  estimated_cost: number;
  currency: string;
  authorization_reference?: string;
  consent_reference?: string;
  message: string;
}

export interface SmsResult {
  ok: boolean;
  status: SmsAuthorizationState;
  messageId?: string;
  error?: string;
  costCharged?: number;
}

export interface SmsPort {
  send(req: SmsRequest): Promise<SmsResult>;
  isConfigured(): boolean;
  getAuthorizationState(smsRequestId: string): SmsAuthorizationState;
}

/**
 * CustomerFundedSmsAdapter — stub implementation.
 *
 * SMS is NOT active by default. It requires:
 *   1. A customer explicitly enabling SMS notifications
 *   2. Consent recorded
 *   3. Billing authorization recorded
 *   4. An SMS provider configured (Twilio, Vonage, etc.)
 *
 * Until all 4 conditions are met, all SMS requests return FAILED with
 * "SMS_AUTHORIZATION_FAILED" or "SMS_PAYMENT_REQUIRED".
 */
export class CustomerFundedSmsAdapter implements SmsPort {
  private providerConfigured: boolean;

  constructor() {
    // SMS provider is configured when SMS_PROVIDER env var is set.
    this.providerConfigured = !!process.env.SMS_PROVIDER;
  }

  isConfigured(): boolean {
    return this.providerConfigured;
  }

  getAuthorizationState(_smsRequestId: string): SmsAuthorizationState {
    // In a full implementation, this would query the authorization state
    // from the database. For now, returns NOT_REQUESTED.
    return "NOT_REQUESTED";
  }

  async send(req: SmsRequest): Promise<SmsResult> {
    // Per §9: SMS requires explicit authorization + consent + billing.
    if (!req.authorization_reference) {
      return {
        ok: false,
        status: "NOT_REQUESTED",
        error: "SMS_AUTHORIZATION_FAILED: no authorization reference",
      };
    }

    if (!req.consent_reference) {
      return {
        ok: false,
        status: "NOT_REQUESTED",
        error: "SMS_AUTHORIZATION_FAILED: no consent reference",
      };
    }

    if (!this.providerConfigured) {
      return {
        ok: false,
        status: "FAILED",
        error: "SMS_PAYMENT_REQUIRED: no SMS provider configured — customer-funded SMS not available",
      };
    }

    // When a provider IS configured, the actual send would happen here.
    // For now, this is a stub that documents the interface.
    return {
      ok: false,
      status: "QUEUED",
      error: "SMS provider integration pending — request queued but not sent",
    };
  }
}

// ── Singleton ──
let _smsAdapter: SmsPort | null = null;

export function getSmsPort(): SmsPort {
  if (!_smsAdapter) {
    _smsAdapter = new CustomerFundedSmsAdapter();
  }
  return _smsAdapter;
}

export function isSmsConfigured(): boolean {
  return getSmsPort().isConfigured();
}
