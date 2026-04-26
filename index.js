import { init } from "./lib/client.js"
import { CONTRACTS, NETWORKS, VERSION } from "./lib/contracts.js"
import { Wad, GripPolicyError, parseExpiry } from "./lib/wad.js"
import { SmartWad } from "./lib/v2/wad.js"
import { createSpendClient } from "./lib/v2/spend-client.js"
import { deriveSmartAccount, getSmartAccountState } from "./lib/v2/smart-account.js"
import { fundingDeeplink, waitForFunding } from "./lib/v2/funding.js"
import { adaptAccount } from "./lib/wallet.js"
import { readUsdcBalance, transferUsdc, USDC_DECIMALS } from "./lib/usdc.js"

export const grip = {
  init,
  VERSION,
  CONTRACTS,
}

export {
  init,
  VERSION,
  CONTRACTS,
  NETWORKS,
  Wad,
  SmartWad,
  GripPolicyError,
  parseExpiry,
  adaptAccount,
  readUsdcBalance,
  transferUsdc,
  USDC_DECIMALS,
  createSpendClient,
  deriveSmartAccount,
  getSmartAccountState,
  fundingDeeplink,
  waitForFunding,
}

export default grip
