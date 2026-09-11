import { toCoinbaseSmartAccount } from "viem/account-abstraction"
import { adaptAccount } from "../wallet.js"
import { PAYMASTER_USDC_REFILL_THRESHOLD_RAW } from "./constants.js"

export async function deriveSmartAccount({ owner, publicClient }) {
  const ownerAccount = adaptAccount(owner)
  return await toCoinbaseSmartAccount({
    client: publicClient,
    owners: [ownerAccount],
  })
}

export async function getSmartAccountState({ smartAccount, paymasterAddress, publicClient, network }) {
  const [code, ethBalance, allowance, usdcBalance] = await Promise.all([
    publicClient.getCode({ address: smartAccount.address }),
    publicClient.getBalance({ address: smartAccount.address }),
    publicClient.readContract({
      address: network.usdc,
      abi: ALLOWANCE_ABI,
      functionName: "allowance",
      args: [smartAccount.address, paymasterAddress],
    }),
    publicClient.readContract({
      address: network.usdc,
      abi: ALLOWANCE_ABI,
      functionName: "balanceOf",
      args: [smartAccount.address],
    }),
  ])

  return {
    address: smartAccount.address,
    deployed: !!code && code !== "0x",
    ethBalance,
    usdcBalance,
    paymasterAllowance: allowance,
    bootstrapped: !!code && code !== "0x" && allowance >= PAYMASTER_USDC_REFILL_THRESHOLD_RAW,
  }
}

const ALLOWANCE_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
]
