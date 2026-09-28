// src/pages/api/ledger.ts
import type { NextApiRequest, NextApiResponse } from 'next';

// Define the shape of a ledger row matching ledgerColumns keys
interface LedgerRow {
  seq: number;
  dateTime: string;
  senderBank: string;
  senderAccount: string;
  senderName: string;
  amount: string;
  receiverBank: string;
  receiverAccount: string;
  receiverName: string;
  reference: string;
}

/**
 * Mock function to retrieve ledger rows.
 * In a real implementation this would query the database or another service.
 */
const getLedgerRows = async (mode: string): Promise<LedgerRow[]> => {
  // For now return an empty array for any mode.
  // You can replace this with actual data fetching logic.
  return [];
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { mode } = req.query;
  if (typeof mode !== 'string') {
    res.status(400).json({ error: 'Missing or invalid mode query parameter' });
    return;
  }

  // Only support SLIP mode for now
  if (mode.toUpperCase() !== 'SLIP') {
    res.status(400).json({ error: 'Unsupported mode. Only SLIP is supported.' });
    return;
  }

  try {
    const rows = await getLedgerRows(mode);
    res.status(200).json(rows);
  } catch (err) {
    console.error('Ledger API error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
