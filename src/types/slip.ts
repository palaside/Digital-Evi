/**
 * Bank Transfer Slip Extraction Schema & Types
 * Forensic Evidence Standard (Court-Admissible)
 */

export interface SlipBank {
  name: string | null;
  confidence: number;
}

export interface SlipTransaction {
  date: string | null; // Format: YYYY-MM-DD
  time: string | null; // Format: HH:mm or HH:mm:ss
  amount: number | null;
  currency: string;
  fee: number | null;
  reference_no: string | null;
  transaction_id: string | null;
  note: string | null;
}

export interface SlipParty {
  name: string | null;
  bank: string | null;
  account_no: string | null;
}

export interface SlipConfidenceScores {
  date: number;
  time: number;
  amount: number;
  reference_no: number;
  sender_name: number;
  receiver_name: number;
  sender_account: number;
  receiver_account: number;
}

export interface BankTransferSlip {
  document_type: "bank_transfer_slip";
  bank: SlipBank;
  transaction: SlipTransaction;
  sender: SlipParty;
  receiver: SlipParty;
  confidence: SlipConfidenceScores;
  raw_text: string[];
  warnings: string[];
}
