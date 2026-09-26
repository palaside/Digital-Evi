"use client";

import React from "react";
import type { HashManifestEntry } from "@/types/cover-sheet";

interface Props {
  entries: HashManifestEntry[];
  caseNumber: string;
  investigatorName?: string;
  investigatorPosition?: string;
  agencyName?: string;
  pageNumber?: string;
}

export default function HashManifestTable({
  entries,
  caseNumber,
  investigatorName = "พ.ต.ท. สมศักดิ์ นิติการ",
  investigatorPosition = "สารวัตรสอบสวน (กลุ่มงานพิสูจน์หลักฐานดิจิทัล)",
  agencyName = "กองบังคับการปราบปรามการกระทำความผิดเกี่ยวกับอาชญากรรมทางเทคโนโลยี (บก.ปอท.)",
  pageNumber = "5 / 5",
}: Props) {
  return (
    <div
      className="bg-white text-slate-900 rounded-lg shadow-2xl relative flex flex-col justify-between select-text"
      style={{
        width: "auto",
        height: "100%",
        aspectRatio: "1 / 1.414",
        maxHeight: "100%",
        padding: "32px 36px",
        fontFamily: "'Sarabun', sans-serif",
      }}
    >
      <div>
        {/* Header Ribbon */}
        <div className="border-b-2 border-slate-900 pb-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-3xl">🔐</span>
            <div>
              <h1 className="text-base font-bold text-slate-900">
                บัญชีคุมลายนิ้วมือดิจิทัล (Chain of Custody & SHA-256 Manifest)
              </h1>
              <p className="text-[10px] text-slate-600">
                รับรองความถูกต้องพยานหลักฐานตาม พ.ร.บ.ธุรกรรมทางอิเล็กทรอนิกส์ พ.ศ. 2544 (ม.26, 28) & ISO/IEC 27037
              </p>
            </div>
          </div>
          <div className="text-right text-xs">
            <div className="font-mono font-bold text-slate-900">PAGE : {pageNumber}</div>
            <div className="text-[10px] text-slate-600 font-mono">คดี: {caseNumber || "Case-2026"}</div>
          </div>
        </div>

        {/* Evidence Hash Table */}
        <div className="mt-3 border border-slate-300 rounded overflow-hidden">
          <table className="w-full text-left border-collapse text-[10.5px]">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-300 font-bold text-slate-800">
                <th className="p-1.5 w-10 text-center">ลำดับ</th>
                <th className="p-1.5">ชื่อไฟล์ต้นฉบับ</th>
                <th className="p-1.5 w-16 text-center">หมวดหมู่</th>
                <th className="p-1.5 w-20 text-right">ขนาด (Bytes)</th>
                <th className="p-1.5">SHA-256 Hash Checksum (64 ตัวอักษร)</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-slate-400">
                    ยังไม่มีรายการพยานหลักฐานในบัญชีคุม (Pure Zero State)
                  </td>
                </tr>
              ) : (
                entries.map((item, idx) => (
                  <tr key={idx} className="border-b border-slate-200 hover:bg-slate-50">
                    <td className="p-1.5 text-center font-mono text-slate-600">{item.no || idx + 1}</td>
                    <td className="p-1.5 font-medium text-slate-800 truncate max-w-[130px]">{item.file_name}</td>
                    <td className="p-1.5 text-center">
                      <span className="px-1.5 py-0.5 rounded text-[8.5px] font-bold bg-slate-200 text-slate-800">
                        {item.file_type}
                      </span>
                    </td>
                    <td className="p-1.5 text-right font-mono text-slate-600 text-[10px]">
                      {item.size_bytes.toLocaleString()}
                    </td>
                    <td className="p-1.5 font-mono text-[8.5px] text-sky-800 break-all leading-tight">
                      {item.sha256}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ===================================================================
            โมดูลที่ 4: CHAIN OF CUSTODY SIGN-OFF BLOCK
            =================================================================== */}
        <div className="mt-3 p-3 bg-slate-50 border border-slate-300 rounded text-xs leading-relaxed">
          <div className="font-bold text-slate-900 text-[11px] mb-1">
            คำรับรองทางนิติวิทยาศาสตร์ดิจิทัล (Forensic Certification Clause):
          </div>
          <p className="text-[10px] text-slate-700 leading-normal">
            ข้าพเจ้าขอรับรองว่า พยานหลักฐานดิจิทัลทั้งหมดตามบัญชีคุมข้างต้น ได้ถูกรวบรวม สกัด และประมวลผล
            จากข้อมูลอิเล็กทรอนิกส์ต้นฉบับจริง โดยมิได้มีการดัดแปลง แก้ไข หรือตัดต่อเนื้อหาข้อมูลส่วนใดส่วนหนึ่ง
            เพื่อประโยชน์แห่งความยุติธรรมตามมาตรฐานสากล ISO/IEC 27037 และ พ.ร.บ.ธุรกรรมทางอิเล็กทรอนิกส์ฯ
          </p>

          <div className="mt-3 flex flex-col items-center text-center">
            <div className="text-[11px] text-slate-800">
              ลงชื่อ .......................................................................... ผู้รวบรวมและตรวจพิสูจน์
            </div>
            <div className="text-[10.5px] font-semibold text-slate-900 mt-0.5">
              ( {investigatorName} )
            </div>
            <div className="text-[10px] text-slate-700">
              ตำแหน่ง: {investigatorPosition}
            </div>
            <div className="text-[10px] text-slate-600">
              หน่วยงาน / สังกัด: {agencyName}
            </div>
            <div className="text-[9.5px] text-slate-500 font-mono mt-0.5">
              วันที่ประมวลผล: {new Date().toLocaleDateString("th-TH")}
            </div>
          </div>
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
