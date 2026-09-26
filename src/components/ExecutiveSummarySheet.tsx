"use client";

import React from "react";
import type { ForensicEvidenceState } from "@/constants/forensic-ssot";

interface Props {
  evidence: ForensicEvidenceState;
  caseNumber: string;
  suspectName?: string;
}

export default function ExecutiveSummarySheet({ evidence, caseNumber, suspectName }: Props) {
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
      <div>
        {/* Header */}
        <div className="border-b-2 border-slate-900 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-3xl">⚖️</span>
            <div>
              <h1 className="text-lg font-bold text-slate-900">
                ใบสรุปความเสียหายและเส้นทางการเงินแห่งคดี (Executive Summary Sheet)
              </h1>
              <p className="text-xs text-slate-600">
                เอกสารสรุปข้อเท็จจริงสำคัญสำหรับการพิจารณาคดีความผิดเกี่ยวกับอาชญากรรมทางเทคโนโลยี
              </p>
            </div>
          </div>
          <div className="text-right text-xs">
            <span className="font-bold text-slate-800">รหัสคดี: </span>
            <span className="font-mono font-semibold">{caseNumber || "Case-2026"}</span>
          </div>
        </div>

        {/* 3 Core Metric KPI Blocks */}
        <div className="grid grid-cols-3 gap-3 my-4">
          <div className="p-3.5 bg-emerald-50 border border-emerald-300 rounded text-center">
            <div className="text-xs text-emerald-800 font-semibold">ยอดความเสียหายสุทธิแห่งคดี (Net Loss)</div>
            <div className="font-mono text-2xl font-bold text-emerald-700 mt-1">
              ฿ {evidence.totalNetLoss.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
            </div>
            <div className="text-[10px] text-emerald-600 mt-0.5">ตัดยอดสลิปซ้ำซ้อนออกแล้ว 100%</div>
          </div>

          <div className="p-3.5 bg-sky-50 border border-sky-300 rounded text-center">
            <div className="text-xs text-sky-800 font-semibold">สลิปโอนเงินสมบูรณ์</div>
            <div className="font-mono text-2xl font-bold text-sky-700 mt-1">
              {evidence.slipCount} รายการ
            </div>
            <div className="text-[10px] text-sky-600 mt-0.5">มี QR EMVCo & OCR ครบถ้วน</div>
          </div>

          <div className="p-3.5 bg-purple-50 border border-purple-300 rounded text-center">
            <div className="text-xs text-purple-800 font-semibold">ความสอดคล้อง แชท ⇋ สลิป</div>
            <div className="font-mono text-2xl font-bold text-purple-700 mt-1">
              {evidence.corroboratedPairsCount} คู่รายการ
            </div>
            <div className="text-[10px] text-purple-600 mt-0.5">จับคู่สั่งโอนและโอนสำเร็จ 1:1</div>
          </div>
        </div>

        {/* Suspect / POI Financial Destination */}
        <div className="mt-4 p-4 border border-slate-300 rounded bg-slate-50 text-xs">
          <h2 className="font-bold text-slate-900 text-sm mb-2 flex items-center gap-1.5">
            <span>🎯</span> สรุปเส้นทางเงินไหลสู่บุคคลเป้าหมาย / บัญชีม้าหลัก (Top Recipient)
          </h2>
          <div className="grid grid-cols-2 gap-3 leading-relaxed">
            <div>
              <span className="text-slate-600 font-medium">ชื่อบุคคลเป้าหมาย / ผู้รับโอน: </span>
              <span className="font-bold text-slate-900">{suspectName || evidence.poiName || "ยังไม่มีข้อมูล"}</span>
            </div>
            <div>
              <span className="text-slate-600 font-medium">มูลค่าความเสียหายเฉพาะบุคคลนี้: </span>
              <span className="font-mono font-bold text-emerald-700">
                ฿ {evidence.poiLossSum.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div>
              <span className="text-slate-600 font-medium">สถานะการตรวจสอบสลิปซ้ำ (Duplicate): </span>
              <span className="text-slate-800 font-medium">
                {evidence.duplicateCount > 0 ? `พบสลิปซ้ำ ${evidence.duplicateCount} จุด (ตัดออกแล้ว)` : "ไม่พบสลิปซ้ำซ้อน 100%"}
              </span>
            </div>
            <div>
              <span className="text-slate-600 font-medium">วัน-เวลาประมวลผลสำนวน: </span>
              <span className="font-mono text-slate-800">{evidence.processedAt || "-"}</span>
            </div>
          </div>
        </div>

        {/* Legal Opinion / Case Summary Statement */}
        <div className="mt-4 p-3.5 border border-slate-200 rounded text-xs text-slate-700 leading-relaxed">
          <h3 className="font-bold text-slate-800 mb-1">สรุปสาระสำคัญแห่งสำนวนคดี:</h3>
          <p>
            พยานหลักฐานดิจิทัลทั้งหมดได้รับการจัดระบบตามลำดับเวลา มีการยืนยันความถูกต้องด้วยลายนิ้วมือดิจิทัล SHA-256
            และตัดยอดรายการซ้ำซ้อนเพื่อป้องกันการฟ้องร้องเรียกค่าเสียหายซ้ำซ้อน (Double-Counting)
            พร้อมนำเสนอต่อศาลและพนักงานอัยการเพื่อประกอบการพิจารณาสั่งฟ้องตามกฎหมาย
          </p>
        </div>
      </div>

      {/* Footer Disclaimer */}
      <div className="text-[8px] text-slate-500 text-center leading-relaxed pt-2 border-t border-slate-200 shrink-0">
        DIGITAL EVIDENCE เป็นเพียงเครื่องมืออำนวยความสะดวกให้กับผู้ว่าจ้าง โดยไม่ได้ดัดแปลง แก้ไข เพิ่ม-ลบ เนื้อหา จากต้นฉบับใดๆ
        และไม่มีส่วนเกี่ยวข้องใดๆ กับเนื้อหาในเอกสาร เป็นเพียงเครื่องมือที่ทำงานเกี่ยวกับระบบไฟล์ เอกสารแบบอิเล็กทรอนิกส์ เท่านั้น
      </div>
    </div>
  );
}
