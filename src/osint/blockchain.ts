/**
 * Blockchain Intelligence — BTC/ETH address analysis, transaction tracing
 * Uses free public APIs: Blockchain.com, Blockstream, Etherscan (limited free)
 */

export interface WalletInfo {
  address: string;
  chain: "bitcoin" | "ethereum";
  balance: string;
  totalReceived?: string;
  totalSent?: string;
  txCount: number;
  firstSeen?: string;
  lastSeen?: string;
  source: string;
}

export interface Transaction {
  hash: string;
  from?: string;
  to?: string;
  value: string;
  fee?: string;
  timestamp: string;
  confirmations: number;
  blockHeight?: number;
}

export interface BlockchainResult {
  address: string;
  chain: "bitcoin" | "ethereum";
  wallet: WalletInfo;
  recentTx: Transaction[];
  relatedAddresses: { address: string; txCount: number; direction: "in" | "out" }[];
  riskIndicators: string[];
  timestamp: string;
}

// ── Bitcoin Analysis (Blockchain.com + Blockstream) ─────

export async function analyzeBitcoinAddress(address: string): Promise<BlockchainResult> {
  const clean = address.replace(/[^a-zA-Z0-9]/g, "");
  const wallet: WalletInfo = { address: clean, chain: "bitcoin", balance: "0", txCount: 0, source: "none" };
  const transactions: Transaction[] = [];
  const relatedAddresses = new Map<string, { count: number; direction: "in" | "out" }>();

  // Source 1: Blockstream API (free, no key)
  try {
    const response = await fetch(`https://blockstream.info/api/address/${clean}`, { signal: AbortSignal.timeout(10000) });
    if (response.ok) {
      const data = await response.json();
      const stats = data.chain_stats || {};
      wallet.balance = satoshiToBtc(stats.funded_txo_sum - stats.spent_txo_sum);
      wallet.totalReceived = satoshiToBtc(stats.funded_txo_sum);
      wallet.totalSent = satoshiToBtc(stats.spent_txo_sum);
      wallet.txCount = (stats.tx_count || 0) + (data.mempool_stats?.tx_count || 0);
      wallet.source = "blockstream";
    }
  } catch {}

  // Get recent transactions
  try {
    const response = await fetch(`https://blockstream.info/api/address/${clean}/txs`, { signal: AbortSignal.timeout(10000) });
    if (response.ok) {
      const txs = await response.json();
      for (const tx of (txs || []).slice(0, 10)) {
        const timestamp = tx.status?.block_time ? new Date(tx.status.block_time * 1000).toISOString() : new Date().toISOString();
        transactions.push({
          hash: tx.txid,
          value: satoshiToBtc(tx.vout?.reduce((s: number, o: any) => s + (o.value || 0), 0) || 0),
          fee: satoshiToBtc(tx.fee || 0),
          timestamp,
          confirmations: tx.status?.confirmed ? 1 : 0,
          blockHeight: tx.status?.block_height,
        });

        // Track related addresses
        for (const vin of (tx.vin || [])) {
          const addr = vin.prevout?.scriptpubkey_address;
          if (addr && addr !== clean) {
            const entry = relatedAddresses.get(addr) || { count: 0, direction: "in" as const };
            entry.count++;
            relatedAddresses.set(addr, entry);
          }
        }
        for (const vout of (tx.vout || [])) {
          const addr = vout.scriptpubkey_address;
          if (addr && addr !== clean) {
            const entry = relatedAddresses.get(addr) || { count: 0, direction: "out" as const };
            entry.count++;
            relatedAddresses.set(addr, entry);
          }
        }
      }
    }
  } catch {}

  const riskIndicators = assessCryptoRisk(wallet, transactions);

  return {
    address: clean, chain: "bitcoin", wallet,
    recentTx: transactions,
    relatedAddresses: Array.from(relatedAddresses.entries())
      .map(([address, { count, direction }]) => ({ address, txCount: count, direction }))
      .sort((a, b) => b.txCount - a.txCount).slice(0, 20),
    riskIndicators,
    timestamp: new Date().toISOString(),
  };
}

// ── Ethereum Analysis ───────────────────────────────────

export async function analyzeEthereumAddress(address: string): Promise<BlockchainResult> {
  const clean = address.toLowerCase().replace(/[^a-f0-9x]/g, "");
  const wallet: WalletInfo = { address: clean, chain: "ethereum", balance: "0", txCount: 0, source: "none" };
  const transactions: Transaction[] = [];

  // Blockscout API (free, no key, multiple chains)
  try {
    const response = await fetch(`https://eth.blockscout.com/api/v2/addresses/${clean}`, { signal: AbortSignal.timeout(10000) });
    if (response.ok) {
      const data = await response.json();
      wallet.balance = weiToEth(data.coin_balance || "0");
      wallet.txCount = data.transactions_count || 0;
      wallet.source = "blockscout";
    }
  } catch {}

  // Get recent transactions
  try {
    const response = await fetch(`https://eth.blockscout.com/api/v2/addresses/${clean}/transactions?limit=10`, { signal: AbortSignal.timeout(10000) });
    if (response.ok) {
      const data = await response.json();
      for (const tx of (data.items || []).slice(0, 10)) {
        transactions.push({
          hash: tx.hash,
          from: tx.from?.hash,
          to: tx.to?.hash,
          value: weiToEth(tx.value || "0"),
          fee: weiToEth(tx.fee?.value || "0"),
          timestamp: tx.timestamp || new Date().toISOString(),
          confirmations: tx.confirmations || 0,
          blockHeight: tx.block,
        });
      }
    }
  } catch {}

  const relatedAddresses = new Map<string, { count: number; direction: "in" | "out" }>();
  for (const tx of transactions) {
    if (tx.from && tx.from !== clean) {
      const e = relatedAddresses.get(tx.from) || { count: 0, direction: "in" as const };
      e.count++; relatedAddresses.set(tx.from, e);
    }
    if (tx.to && tx.to !== clean) {
      const e = relatedAddresses.get(tx.to) || { count: 0, direction: "out" as const };
      e.count++; relatedAddresses.set(tx.to, e);
    }
  }

  return {
    address: clean, chain: "ethereum", wallet,
    recentTx: transactions,
    relatedAddresses: Array.from(relatedAddresses.entries())
      .map(([address, { count, direction }]) => ({ address, txCount: count, direction }))
      .sort((a, b) => b.txCount - a.txCount).slice(0, 20),
    riskIndicators: assessCryptoRisk(wallet, transactions),
    timestamp: new Date().toISOString(),
  };
}

// ── Auto-detect chain ───────────────────────────────────

export async function analyzeBlockchainAddress(address: string): Promise<BlockchainResult> {
  if (address.startsWith("0x") && address.length === 42) return analyzeEthereumAddress(address);
  if (address.startsWith("1") || address.startsWith("3") || address.startsWith("bc1")) return analyzeBitcoinAddress(address);
  // Default to Bitcoin
  return analyzeBitcoinAddress(address);
}

// ── Risk Assessment ─────────────────────────────────────

function assessCryptoRisk(wallet: WalletInfo, txs: Transaction[]): string[] {
  const risks: string[] = [];
  if (wallet.txCount === 0) risks.push("Empty wallet — no transaction history");
  if (wallet.txCount === 1) risks.push("Single-use address — possible tumbler output");
  if (wallet.txCount > 10000) risks.push("Very high transaction volume — possible exchange or mixer");
  if (txs.length > 0) {
    const recent = txs.filter(t => Date.now() - new Date(t.timestamp).getTime() < 3600000);
    if (recent.length > 5) risks.push("High recent activity — multiple transactions in the last hour");
  }
  return risks;
}

function satoshiToBtc(satoshi: number): string {
  return (satoshi / 100000000).toFixed(8);
}

function weiToEth(wei: string): string {
  const num = BigInt(wei || "0");
  const eth = Number(num) / 1e18;
  return eth.toFixed(6);
}
