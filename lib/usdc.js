import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  encodeFunctionData,
  isAddress,
  getAddress,
} from "viem"
import { base } from "viem/chains"

const USDC_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
]

export const USDC_DECIMALS = 6

export function makePublicClient(rpc) {
  return createPublicClient({ chain: base, transport: http(rpc) })
}

export async function readUsdcBalance({ address, network }) {
  if (!isAddress(address)) throw new TypeError(`Invalid address: ${address}`)
  const client = makePublicClient(network.rpc)
  const raw = await client.readContract({
    address: network.usdc,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [getAddress(address)],
  })
  const formatted = formatUnits(raw, USDC_DECIMALS)
  return {
    raw,
    formatted,
    usd: Number(formatted),
  }
}

export async function transferUsdc({ account, to, amountUsd, network }) {
  if (!isAddress(to)) throw new TypeError(`Invalid recipient address: ${to}`)
  if (typeof amountUsd !== "number" || !Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new TypeError(`amount must be a positive number, got: ${amountUsd}`)
  }
  const stringAmount = String(amountUsd)
  const decimalsInInput = stringAmount.includes(".") ? stringAmount.split(".")[1].length : 0
  if (decimalsInInput > USDC_DECIMALS) {
    throw new TypeError(`amount exceeds USDC granularity (max ${USDC_DECIMALS} decimals): ${amountUsd}`)
  }

  const publicClient = makePublicClient(network.rpc)
  const wallet = createWalletClient({ account, chain: base, transport: http(network.rpc) })
  const value = parseUnits(stringAmount, USDC_DECIMALS)
  const data = encodeFunctionData({
    abi: USDC_ABI,
    functionName: "transfer",
    args: [getAddress(to), value],
  })
  const hash = await wallet.sendTransaction({ to: network.usdc, data })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  return {
    hash,
    status: receipt.status,
    blockNumber: receipt.blockNumber.toString(),
  }
}
