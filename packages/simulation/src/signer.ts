import { Keypair } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { FRIENDBOT_URL, NETWORK_PASSPHRASE } from "./constants.js";

const STATE_DIR = resolve(import.meta.dirname, "..", "state");
const KEYPAIRS_FILE = resolve(STATE_DIR, "keypairs.json");

export function createKeypair(): Keypair {
  return Keypair.random();
}

export function createSigner(kp: Keypair, passphrase = NETWORK_PASSPHRASE) {
  const { signTransaction, signAuthEntry } = basicNodeSigner(kp, passphrase);
  return {
    publicKey: kp.publicKey(),
    signTransaction,
    signAuthEntry,
  };
}

export async function fundAccount(publicKey: string, friendbotUrl = FRIENDBOT_URL): Promise<void> {
  const url = `${friendbotUrl}?addr=${publicKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    // Ignore "already funded" errors
    if (!body.includes("createAccountAlreadyExist")) {
      throw new Error(`Friendbot funding failed for ${publicKey}: ${res.status} ${body}`);
    }
  }
}

interface StoredKeypair {
  publicKey: string;
  secret: string;
}

async function loadStoredKeypairs(): Promise<StoredKeypair[]> {
  try {
    const data = await readFile(KEYPAIRS_FILE, "utf-8");
    return JSON.parse(data) as StoredKeypair[];
  } catch {
    return [];
  }
}

async function appendKeypairs(keypairs: Keypair[]): Promise<void> {
  const existing = await loadStoredKeypairs();
  const entries = keypairs.map((kp) => ({
    publicKey: kp.publicKey(),
    secret: kp.secret(),
  }));
  await writeFile(KEYPAIRS_FILE, JSON.stringify([...existing, ...entries], null, 2));
}

export async function createFundedUsers(
  mintUsdc: (to: string, amount: bigint) => Promise<void>,
  count: number,
  usdcPerUser: bigint,
  friendbotUrl = FRIENDBOT_URL,
): Promise<Keypair[]> {
  const keypairs: Keypair[] = [];

  for (let i = 0; i < count; i++) {
    const kp = createKeypair();
    await fundAccount(kp.publicKey(), friendbotUrl);
    await mintUsdc(kp.publicKey(), usdcPerUser);
    keypairs.push(kp);

    if ((i + 1) % 10 === 0) {
      console.log(`  [signer] Funded ${i + 1}/${count} users`);
    }
  }

  await appendKeypairs(keypairs);
  console.log(`  [signer] ${count} users funded and saved to state/keypairs.json`);
  return keypairs;
}

export function loadKeypairs(): Promise<StoredKeypair[]> {
  return loadStoredKeypairs();
}

export async function clearKeypairState(): Promise<void> {
  try {
    await rm(KEYPAIRS_FILE);
    console.log("[cleanup] Removed state/keypairs.json");
  } catch {
    console.log("[cleanup] No keypair state to clean up");
  }
}
