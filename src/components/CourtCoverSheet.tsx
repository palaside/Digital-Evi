"use client";

import React from "react";
import type { CourtCoverSheetData } from "@/types/cover-sheet";

interface Props {
  data: CourtCoverSheetData;
  onPrint?: () => void;
}

export default function CourtCoverSheet({ data }: Props) {
  const { defaults, active_cards } = data;

  // Calculate Grand Total Pages
  let addonPages = 0;
  if (active_cards.summary_ledger.enabled) addonPages += active_cards.summary_ledger.pages;
  if (active_cards.poi_target.enabled) addonPages += active_cards.poi_target.pages;
  if (active_cards.corroborated_pairs.enabled) addonPages += active_cards.corroborated_pairs.pages;
  if (active_cards.hash_manifest.enabled) addonPages += active_cards.hash_manifest.pages;

  const baselineTotal = defaults.chat_pages + defaults.slip_pages;
  const grandTotal = baselineTotal + addonPages + 1; // +1 for cover sheet itself

  return (
    <div
      className="bg-white text-slate-900 rounded-lg shadow-2xl relative flex flex-col justify-between select-text"
      style={{
        width: "auto",
        height: "100%",
        aspectRatio: "1 / 1.414",
        maxHeight: "100%",
        padding: "36px 44px",
        fontFamily: "'Sarabun', sans-serif",
      }}
    >
      {/* Official Court Top Header */}
      <div>
        <div className="flex flex-col items-center text-center pb-4 border-b-2 border-slate-900">
          <img
            src="/LOGO.png"
            alt="Official Digital Evidence Emblem"
            className="h-14 w-auto object-contain mb-2 select-none"
          />
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            {data.dossier_title || "รายงานสรุปสำนวนพยานหลักฐานดิจิทัลคดีอาญา"}
          </h1>
          <p className="text-xs font-semibold text-slate-700 mt-0.5">
            มาตรฐานการตรวจพิสูจน์พยานหลักฐานดิจิทัล ISO/IEC 27037 & พ.ร.บ.ธุรกรรมทางอิเล็กทรอนิกส์
          </p>
        </div>

        {/* Case Dossier Meta Grid */}
        <div className="grid grid-cols-2 gap-3 py-3 border-b border-slate-300 text-xs">
          <div>
            <span className="font-bold text-slate-800">เลขที่คดี / เลขรับแจ้ง: </span>
            <span className="text-slate-900 font-mono font-semibold">{data.case_number || "รหัสคดีค้างตรวจสอบ"}</span>
          </div>
          <div>
            <span className="font-bold text-slate-800">สถานีตำรวจ / หน่วยงาน: </span>
            <span className="text-slate-900">{data.police_station || "กองบังคับการปราบปรามการกระทำความผิดเกี่ยวกับอาชญากรรมทางเทคโนโลยี (บก.ปอท.)"}</span>
          </div>
          <div>
            <span className="font-bold text-slate-800">ผู้กล่าวหา / ผู้เสียหาย: </span>
            <span className="text-slate-900">{data.complainant_name || "นายสมชาย ใจดี (ผู้เสียหาย)"}</span>
          </div>
          <div>
            <span className="font-bold text-slate-800">ผู้ต้องหา / บุคคลเป้าหมาย: </span>
            <span className="text-slate-900 font-semibold text-red-700">{data.suspect_name || active_cards.poi_target.name || "อยู่ระหว่างสืบสวนระบุตัวตน"}</span>
          </div>
          <div className="col-span-2 text-slate-600 font-mono text-[11px]">
            วัน-เวลาจัดทำสำนวน: {data.timestamp}
          </div>
        </div>

        {/* Dynamic Evidence Table of Contents */}
        <div className="mt-4">
          <h2 className="text-sm font-bold text-slate-900 mb-2 flex items-center gap-1.5">
            <span>📑</span> สารบัญและรายการบัญชีคุมเอกสารในสำนวน
          </h2>

          <div className="bg-slate-50 border border-slate-300 rounded p-3 text-xs leading-relaxed">
            {/* Level 1: Default Baseline */}
            <div className="font-semibold text-slate-800 mb-1">
              [ 1. เอกสารหลักฐานดิบตั้งต้น (Default Baseline) ]
            </div>
            <a href="#section-evidence" className="flex justify-between pl-3 text-slate-700 hover:text-sky-700 hover:underline cursor-pointer">
              <span>• เอกสารบทสนทนาแชท (Chat Records)</span>
              <span className="font-mono font-semibold">{defaults.chat_pages} แผ่น ↗</span>
            </a>
            <a href="#section-evidence" className="flex justify-between pl-3 text-slate-700 hover:text-sky-700 hover:underline cursor-pointer">
              <span>• สลิปการเงิน/ธุรกรรมธนาคาร (Bank Transfer Slips)</span>
              <span className="font-mono font-semibold">{defaults.slip_pages} แผ่น ↗</span>
            </a>
            <div className="border-t border-slate-200 mt-1 pt-1 flex justify-between font-semibold text-slate-800 pl-3">
              <span>รวมจำนวนเอกสารหลักฐานตั้งต้น</span>
              <span className="font-mono">{baselineTotal} แผ่น</span>
            </div>

            {/* Level 2: Dynamic Add-on Cards (Clickable Cross-Reference Linkage) */}
            {addonPages > 0 && (
              <div className="mt-3 pt-2 border-t border-dashed border-slate-300">
                <div className="font-semibold text-slate-800 mb-1">
                  [ 2. เอกสารและบัญชีวิเคราะห์เชิงลึกแห่งคดี (Dynamic Add-on Cards) ]
                </div>

                {active_cards.summary_ledger.enabled && (
                  <a href="#section-ledger" className="flex justify-between pl-3 text-slate-700 py-0.5 hover:text-sky-700 hover:underline cursor-pointer">
                    <span>+ ตารางบัญชีคุมและเส้นทางธุรกรรม ๑๓ ช่อง</span>
                    <span className="font-mono font-semibold">{active_cards.summary_ledger.pages} แผ่น ↗</span>
                  </a>
                )}

                {active_cards.poi_target.enabled && (
                  <a href="#section-executive" className="flex justify-between pl-3 text-slate-700 py-0.5 hover:text-sky-700 hover:underline cursor-pointer">
                    <span>+ บัญชีธุรกรรมเฉพาะบุคคลเป้าหมาย ({active_cards.poi_target.name || "POI"}) (มูลค่า ฿ {active_cards.poi_target.amount})</span>
                    <span className="font-mono font-semibold">{active_cards.poi_target.pages} แผ่น ↗</span>
                  </a>
                )}

                {active_cards.corroborated_pairs.enabled && (
                  <a href="#section-evidence" className="flex justify-between pl-3 text-slate-700 py-0.5 hover:text-sky-700 hover:underline cursor-pointer">
                    <span>+ พยานหลักฐานแชทสั่งโอนเคียงคู่สลิปจริง (Consistent 1:1: {active_cards.corroborated_pairs.pairs_count} คู่)</span>
                    <span className="font-mono font-semibold">{active_cards.corroborated_pairs.pages} แผ่น ↗</span>
                  </a>
                )}

                {active_cards.forensic_net.enabled && (
                  <a href="#section-executive" className="flex justify-between pl-3 text-slate-700 py-0.5 hover:text-sky-700 hover:underline cursor-pointer">
                    <span>+ บันทึกการตรวจจับและตัดยอดสลิปซ้ำซ้อน ({active_cards.forensic_net.duplicates_cut} จุด, ยอดสุทธิ ฿ {active_cards.forensic_net.net_loss_amount})</span>
                    <span className="font-mono text-emerald-700 font-semibold">รับรองยอดสุทธิ ↗</span>
                  </a>
                )}

                {active_cards.hash_manifest.enabled && (
                  <a href="#section-manifest" className="flex justify-between pl-3 text-slate-700 py-0.5 hover:text-sky-700 hover:underline cursor-pointer">
                    <span>+ บัญชีคุมลายนิ้วมือดิจิทัล SHA-256 (ISO/IEC 27037 Chain of Custody)</span>
                    <span className="font-mono font-semibold">{active_cards.hash_manifest.pages} แผ่น ↗</span>
                  </a>
                )}

                {active_cards.sfx_vault?.enabled && (
                  <div className="flex justify-between pl-3 text-slate-700 py-0.5">
                    <span>+ แฟ้มสำนวนดิจิทัลเข้ารหัส WinRAR SFX (.exe) คุ้มครองความปลอดภัย (-hp)</span>
                    <span className="font-mono text-sky-700 font-semibold">แนบแฟ้มสำเร็จรูป</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Grand Total Summary Box */}
          <div className="mt-3 p-2.5 bg-slate-900 text-white rounded flex justify-between items-center text-xs font-semibold">
            <span>รวมจำนวนเอกสารในเล่มสำนวนคดีทั้งสิ้น (รวมหน้าปก):</span>
            <span className="font-mono text-base text-emerald-400 font-bold">{grandTotal} แผ่น</span>
          </div>
        </div>
      </div>

      {/* Official Signatures & Chain of Custody Footer */}
      <div className="pt-4 border-t border-slate-300 text-xs">
        <div className="grid grid-cols-2 gap-8 text-center pt-2">
          <div className="flex flex-col items-center">
            <div className="w-48 border-b border-dotted border-slate-500 h-8 mb-1"></div>
            <span className="font-semibold text-slate-800">( ลงชื่อผู้กล่าวหา / ผู้ส่งมอบพยานหลักฐาน )</span>
            <span className="text-[11px] text-slate-600 mt-0.5">วันที่ ........ / ........ / ................</span>
          </div>

          <div className="flex flex-col items-center">
            <div className="w-48 border-b border-dotted border-slate-500 h-8 mb-1"></div>
            <span className="font-semibold text-slate-800">( ลงชื่อพนักงานสอบสวน / เจ้าหน้าที่ผู้รับสำนวน )</span>
            <span className="text-[11px] text-slate-600 mt-0.5">วันที่ ........ / ........ / ................</span>
          </div>
        </div>

        {/* SSOT Legal Disclaimer 3 lines */}
        <div className="text-[8px] text-slate-500 text-center leading-relaxed mt-4 pt-2 border-t border-slate-200">
          DIGITAL EVIDENCE เป็นเพียงเครื่องมืออำนวยความสะดวกให้กับผู้ว่าจ้าง โดยไม่ได้ดัดแปลง แก้ไข เพิ่ม-ลบ เนื้อหา จากต้นฉบับใดๆ
          <br />
          และไม่มีส่วนเกี่ยวข้องใดๆ กับเนื้อหาในเอกสาร เป็นเพียงเครื่องมือที่ทำงานเกี่ยวกับระบบไฟล์ เอกสารแบบอิเล็กทรอนิกส์ เท่านั้น
        </div>
      </div>
    </div>
  );
}
