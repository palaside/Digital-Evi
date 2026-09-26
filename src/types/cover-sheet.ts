/**
 * Court Cover Sheet & Forensic Dossier Data Contract
 * Standard: ISO/IEC 27037 & Thai Electronic Transactions Act
 */

export interface CoverSheetDefaults {
  chat_pages: number;
  slip_pages: number;
}

export interface SummaryLedgerCard {
  enabled: boolean;
  pages: number;
}

export interface PoiTargetCard {
  enabled: boolean;
  name: string;
  pages: number;
  amount: string;
}

export interface CorroboratedPairsCard {
  enabled: boolean;
  pairs_count: number;
  pages: number;
}

export interface ForensicNetCard {
  enabled: boolean;
  duplicates_cut: number;
  net_loss_amount: string;
}

export interface HashManifestCard {
  enabled: boolean;
  pages: number;
}

export interface SfxVaultCard {
  enabled: boolean;
  archive_name?: string;
  is_password_protected?: boolean;
}

export interface ActiveCardsConfig {
  summary_ledger: SummaryLedgerCard;
  poi_target: PoiTargetCard;
  corroborated_pairs: CorroboratedPairsCard;
  forensic_net: ForensicNetCard;
  hash_manifest: HashManifestCard;
  sfx_vault?: SfxVaultCard;
}

export interface CourtCoverSheetData {
  dossier_title: string;
  case_number: string;
  police_station?: string;
  investigator_name?: string;
  complainant_name?: string;
  suspect_name?: string;
  timestamp: string;
  defaults: CoverSheetDefaults;
  active_cards: ActiveCardsConfig;
}

export interface HashManifestEntry {
  no: number;
  file_name: string;
  file_type: "CHAT" | "SLIP" | "REPORT" | "LEDGER";
  size_bytes: number;
  sha256: string;
  intake_timestamp: string;
}
