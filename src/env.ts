export type AppBindings = Omit<
  CloudflareBindings,
  "AI" | "PAYMENTS_ENABLED" | "TXLINE_LIVE_ENABLED"
> & {
  AI: Ai;
  PAYMENTS_ENABLED: string;
  TXLINE_LIVE_ENABLED: string;
  ADMIN_TOKEN?: string;
  GITHUB_TOKEN?: string;
  SUPERTEAM_AGENT_API_KEY?: string;
  X402_RECEIVER_ADDRESS?: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
  CONTROLLED_PAYER_ADDRESSES?: string;
  TXLINE_GUEST_JWT?: string;
  TXLINE_API_TOKEN?: string;
  GRANT_RESPONSE_DRIVE_URL?: string;
  TXODDS_DEMO_URL?: string;
};
