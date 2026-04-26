import { createPublicClient, http } from "viem"
import { base } from "viem/chains"
import { adaptAccount } from "./wallet.js"
import { readUsdcBalance } from "./usdc.js"
import { Wad } from "./wad.js"
import { SmartWad } from "./v2/wad.js"
import { createSpendClient } from "./v2/spend-client.js"
import { fundingDeeplink, waitForFunding } from "./v2/funding.js"
import { getAdapter, listProviders } from "./v2/onramp/index.js"
import { NETWORKS } from "./contracts.js"

// Default Grip-managed paymaster proxy. Lets agents skip Pimlico signup entirely.
// The proxy uses Grip's shared upstream Pimlico key on the user's behalf.
const DEFAULT_GRIP_API_URL = "https://grip-paymaster-proxy.vercel.app/api/v1/rpc"

export function init({
  account,
  network = "base",
  rpc,
  mode = "smart",
  pimlicoApiKey,
  gripApiUrl,
  managed = false,
} = {}) {
  const netDef = NETWORKS[network]
  if (!netDef) {
    throw new TypeError(`Unsupported network: "${network}". v0.1.x supports: ${Object.keys(NETWORKS).join(", ")}`)
  }
  if (mode !== "smart" && mode !== "eoa") {
    throw new TypeError(`mode must be "smart" or "eoa", got: ${mode}`)
  }

  const adapted = adaptAccount(account)
  const resolvedNetwork = {
    chainId: netDef.chainId,
    name: netDef.name,
    rpc: rpc || netDef.defaultRpc,
    explorer: netDef.explorer,
    usdc: netDef.usdc,
    grip: netDef.grip,
  }

  if (mode === "eoa") {
    return createEoaClient({ adapted, network: resolvedNetwork })
  }

  // mode === "smart"
  // Resolution order for paymaster transport:
  // 1. Explicit gripApiUrl → use it
  // 2. managed=true OR env GRIP_API_URL → use default Grip proxy
  // 3. pimlicoApiKey (or env) → use Pimlico directly (BYOK)
  // 4. Neither → throw with clear instructions
  const envGripUrl = process.env.GRIP_API_URL
  const envPimlicoKey = process.env.GRIP_PIMLICO_KEY

  let resolvedGripApiUrl = null
  let resolvedPimlicoKey = null

  if (gripApiUrl) {
    resolvedGripApiUrl = gripApiUrl
  } else if (managed || envGripUrl) {
    resolvedGripApiUrl = envGripUrl || DEFAULT_GRIP_API_URL
  } else if (pimlicoApiKey || envPimlicoKey) {
    resolvedPimlicoKey = pimlicoApiKey || envPimlicoKey
  }

  if (!resolvedGripApiUrl && !resolvedPimlicoKey) {
    throw new TypeError(
      `mode "smart" needs paymaster auth. Easiest: pass { managed: true } to use Grip's hosted paymaster (no signup). ` +
      `Or pass { pimlicoApiKey } for BYOK self-managed Pimlico. ` +
      `Or use mode: "eoa" for v0.1-style direct EOA without paymaster.`,
    )
  }

  return createSmartClient({
    adapted,
    network: resolvedNetwork,
    pimlicoApiKey: resolvedPimlicoKey,
    gripApiUrl: resolvedGripApiUrl,
  })
}

function createEoaClient({ adapted, network }) {
  return {
    mode: "eoa",
    address: adapted.address,
    network: network.name,
    chainId: network.chainId,

    openWad(opts = {}) {
      return new Wad({ account: adapted, network, ...opts })
    },

    async balance() {
      return await readUsdcBalance({ address: adapted.address, network })
    },
  }
}

function createSmartClient({ adapted, network, pimlicoApiKey, gripApiUrl }) {
  const publicClient = createPublicClient({ chain: base, transport: http(network.rpc) })

  // The smart account address differs from the EOA address — we lazy-derive on first use
  // to avoid making the init() call async.
  let _spendClient = null
  const getSpendClient = async () => {
    if (_spendClient) return _spendClient
    _spendClient = await createSpendClient({
      owner: adapted,
      publicClient,
      network,
      pimlicoApiKey,
      gripApiUrl,
    })
    return _spendClient
  }

  return {
    mode: "smart",
    network: network.name,
    chainId: network.chainId,
    eoaAddress: adapted.address,

    async address() {
      const sc = await getSpendClient()
      return sc.address
    },

    async balance() {
      const sc = await getSpendClient()
      return await readUsdcBalance({ address: sc.address, network })
    },

    async state() {
      const sc = await getSpendClient()
      return await sc.state()
    },

    async openWad(opts = {}) {
      const sc = await getSpendClient()
      return new SmartWad({ spendClient: sc, ...opts })
    },

    async fundingDeeplink({ amount, wallet = "coinbase" } = {}) {
      const sc = await getSpendClient()
      return fundingDeeplink({
        smartAccount: sc.address,
        amount,
        wallet,
        token: network.usdc,
      })
    },

    async waitForFunding({ minUsd, timeoutSeconds = 600, pollSeconds = 5, onPoll } = {}) {
      const sc = await getSpendClient()
      return await waitForFunding({
        address: sc.address,
        network,
        minUsd,
        timeoutSeconds,
        pollSeconds,
        onPoll,
      })
    },

    async onramp({ provider = "coinbase", amount, fiat = "USD" } = {}) {
      const sc = await getSpendClient()
      const adapter = getAdapter(provider)
      return await adapter.createSession({
        destinationAddress: sc.address,
        amount,
        fiat,
        network: network.name,
      })
    },

    onrampProviders() {
      return listProviders().map((name) => {
        const adapter = getAdapter(name)
        return { name, ...adapter.metadata }
      })
    },
  }
}
