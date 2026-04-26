import { privateKeyToAccount } from "viem/accounts"
import { isHex } from "viem"

export function adaptAccount(input) {
  if (!input) {
    throw new TypeError("grip.init requires { account } — pass a hex private key (0x...) or a viem Account")
  }
  if (typeof input === "string") {
    if (!isHex(input) || input.length !== 66) {
      throw new TypeError("account string must be a 0x-prefixed 32-byte hex private key")
    }
    return privateKeyToAccount(input)
  }
  if (typeof input === "object" && input.address && typeof input.signMessage === "function") {
    return input
  }
  throw new TypeError("account must be a hex private key string or a viem Account")
}
