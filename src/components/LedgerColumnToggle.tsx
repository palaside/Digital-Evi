// src/components/LedgerColumnToggle.tsx
import React, { useState, useEffect } from 'react';
import { FiSettings, FiX } from 'react-icons/fi';

/**
 * Columns for the SLIP ledger table.
 */
export const ledgerColumns = [
  { key: 'seq', label: 'ลำดับ' },
  { key: 'dateTime', label: 'วัน-เวลา' },
  { key: 'senderBank', label: 'ธนาคารผู้โอน' },
  { key: 'senderAccount', label: 'เลขที่บัญชีผู้โอน' },
  { key: 'senderName', label: 'ชื่อผู้โอนจริง' },
  { key: 'amount', label: 'ยอดเงิน (บาท)' },
  { key: 'receiverBank', label: 'ธนาคารผู้รับ' },
  { key: 'receiverAccount', label: 'เลขที่บัญชีผู้รับ' },
  { key: 'receiverName', label: 'ชื่อผู้รับโอนจริง' },
  { key: 'reference', label: 'รหัสอ้างอิงธุรกรรม' },
];

/**
 * Props for the column toggle component.
 */
interface Props {
  visible: Record<string, boolean>;
  setVisible: (newState: Record<string, boolean>) => void;
  persist?: boolean; // if true, sync to localStorage
}

export const LedgerColumnToggle: React.FC<Props> = ({ visible, setVisible, persist = false }) => {
  const [open, setOpen] = useState(false);

  // Persist visibility to localStorage when requested
  useEffect(() => {
    if (persist) {
      const stored = localStorage.getItem('ledgerColumnVisibility');
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setVisible(parsed);
        } catch (_) {}
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (persist) {
      localStorage.setItem('ledgerColumnVisibility', JSON.stringify(visible));
    }
  }, [visible, persist]);

  const toggleColumn = (key: string) => {
    setVisible({ ...visible, [key]: !visible[key] });
  };

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(!open)}
        className="p-1 rounded-full hover:bg-white/10 transition-colors"
        title="ตั้งค่าคอลัมน์"
      >
        <FiSettings className="text-slate-300 w-4 h-4" />
      </button>
      {open && (
        <div
          className={`absolute right-0 mt-2 w-56 bg-[#070a0f]/90 backdrop-blur-md border border-white/10 rounded shadow-lg p-3 transition-opacity duration-200 ${open ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1'}`}
          onClick={e => e.stopPropagation()}
        >
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-slate-200">ตั้งค่าคอลัมน์</span>
            <button onClick={() => setOpen(false)} className="p-0.5 hover:text-slate-100">
              <FiX className="w-3 h-3" />
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {ledgerColumns.map(col => (
              <label key={col.key} className="flex items-center text-xs text-slate-300 mb-1">
                <input
                  type="checkbox"
                  checked={!!visible[col.key]}
                  onChange={() => toggleColumn(col.key)}
                  className="mr-2"
                />
                {col.label}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
