import { NextResponse } from "next/server";
import crypto from "crypto";
import { SlipExtractionSchema, type SlipExtraction } from "@/schemas/slip.schema";

const SLIP_EXTRACTION_SYSTEM_PROMPT = `คุณเป็นระบบสกัดข้อมูลจากหลักฐานประเภท "สลิปโอนเงินธนาคารไทย"

หน้าที่ของคุณคืออ่านข้อความจากภาพสลิปที่ได้รับ และแปลงข้อมูลที่ปรากฏจริงในภาพให้อยู่ในรูปแบบ JSON ตาม schema ที่กำหนด

กฎสำคัญ:
1. อ่านเฉพาะข้อมูลที่มองเห็นจริงจากภาพ ห้ามคาดเดา ห้ามเติมข้อมูลที่ไม่มีในภาพ
2. หากอ่านค่าใดไม่ชัดเจน หรือไม่มีข้อมูล ให้ใส่ค่า null
3. ห้ามแก้ไขชื่อบุคคลโดยการคาดเดา แม้จะคิดว่าสะกดผิด
4. ต้องรักษาการสะกดภาษาไทยตามที่ปรากฏบนสลิปให้มากที่สุด
5. หมายเลขบัญชี เลขอ้างอิง และเลขธุรกรรม ต้องรักษาตัวเลขตามต้นฉบับ ห้ามเติมเลขที่หายไป
6. จำนวนเงินให้แปลงเป็น number โดยตัด comma และคำว่า "บาท" ออก
7. วันที่ให้แปลงเป็นรูปแบบ YYYY-MM-DD หากระบุได้แน่นอน
8. หากปีเป็น พ.ศ. ให้แปลงเป็น ค.ศ. โดยลบ 543
9. เวลาให้แปลงเป็นรูปแบบ HH:mm:ss หากไม่มีวินาที ให้ใช้ HH:mm
10. ห้ามสรุป วิเคราะห์ หรือแสดงความคิดเห็นเกี่ยวกับธุรกรรม
11. ห้ามระบุว่าหลักฐานเป็นของจริงหรือปลอม
12. ค่า confidence ต้องอยู่ระหว่าง 0 ถึง 1 และสะท้อนความชัดเจนที่อ่านได้จากภาพ
13. หากไม่แน่ใจในตัวอักษรหรือตัวเลข ให้ลด confidence และใช้ null หากไม่สามารถอ่านได้อย่างน่าเชื่อถือ
14. ส่งผลลัพธ์เป็น JSON เท่านั้น ห้ามใส่ Markdown, code fence, คำอธิบาย หรือข้อความอื่นนอก JSON
15. กฎโมดูลที่ 3 (NON-QR LOW-QUALITY SLIP FALLBACK): หากเป็นสลิปโอนเงินแต่ไม่มี QR Code หรือ QR ฉีกขาด/สลิปตู้ ให้ถอดรหัสข้อความผ่าน Text Heuristics & Thai Banking Regex (จำนวนเงิน, วันที่, ธนาคาร, Ref ID) ห้ามปฏิเสธภาพ และให้ใส่คำว่า "VERIFIED_BY_OCR_FALLBACK (NO_QR)" ไว้ใน array "warnings" เสมอเพื่อความโปร่งใสในชั้นศาล

โครงสร้าง JSON ที่ต้องคืน:
{
  "document_type": "bank_transfer_slip",
  "bank": {
    "name": null,
    "confidence": 0
  },
  "transaction": {
    "date": null,
    "time": null,
    "amount": null,
    "currency": "THB",
    "fee": null,
    "reference_no": null,
    "transaction_id": null,
    "note": null
  },
  "sender": {
    "name": null,
    "bank": null,
    "account_no": null
  },
  "receiver": {
    "name": null,
    "bank": null,
    "account_no": null
  },
  "confidence": {
    "date": 0,
    "time": 0,
    "amount": 0,
    "reference_no": 0,
    "sender_name": 0,
    "receiver_name": 0,
    "sender_account": 0,
    "receiver_account": 0
  },
  "raw_text": [],
  "warnings": []
}`;

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    let base64Image = "";
    let mimeType = "image/png";
    let fileName = "slip_evidence.png";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;

      if (!file) {
        return NextResponse.json(
          { success: false, message: "ไม่พบไฟล์ภาพในคำขอ (file is required)" },
          { status: 400 }
        );
      }

      fileName = file.name;
      mimeType = file.type || "image/png";
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      base64Image = buffer.toString("base64");
    } else {
      const jsonBody = (await request.json()) as {
        image?: string;
        mimeType?: string;
        fileName?: string;
      };

      if (!jsonBody.image) {
        return NextResponse.json(
          { success: false, message: "ไม่พบข้อมูลภาพ base64 ในคำขอ" },
          { status: 400 }
        );
      }

      base64Image = jsonBody.image.replace(/^data:image\/[a-z]+;base64,/, "");
      mimeType = jsonBody.mimeType || "image/png";
      if (jsonBody.fileName) fileName = jsonBody.fileName;
    }

    // Forensic Checksum: SHA-256 calculation
    const imageBuffer = Buffer.from(base64Image, "base64");
    const sha256 = crypto.createHash("sha256").update(imageBuffer).digest("hex");

    // Call Vision AI Engine (Gemini 2.5 Flash via REST API)
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          message: "ไม่พบคีย์ API สำหรับ Vision AI (GEMINI_API_KEY หรือ GOOGLE_API_KEY)",
        },
        { status: 500 }
      );
    }

    const aiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const aiPayload = {
      contents: [
        {
          parts: [
            { text: SLIP_EXTRACTION_SYSTEM_PROMPT },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64Image,
              },
            },
          ],
        },
      ],
      generationConfig: {
        response_mime_type: "application/json",
        temperature: 0.1,
      },
    };

    const aiResponse = await fetch(aiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(aiPayload),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      return NextResponse.json(
        {
          success: false,
          message: `Vision AI ตอบกลับข้อผิดพลาด (${aiResponse.status}): ${errorText}`,
        },
        { status: 502 }
      );
    }

    const aiResult = await aiResponse.json();
    const rawText =
      aiResult?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

    if (!rawText) {
      return NextResponse.json(
        { success: false, message: "AI ไม่สามารถอ่านข้อความจากภาพได้" },
        { status: 422 }
      );
    }

    // Clean potential markdown wrap if any
    const cleanJson = rawText.replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(cleanJson);
    } catch {
      return NextResponse.json(
        {
          success: false,
          message: "ผลลัพธ์จาก AI ไม่สามารถแปลงเป็น JSON ได้",
          raw_output: rawText,
        },
        { status: 422 }
      );
    }

    // Zod Validation Gatekeeper
    const validation = SlipExtractionSchema.safeParse(parsedJson);

    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          message: "ข้อมูลสลิปที่ AI สกัดไม่ผ่านการตรวจสอบ Zod Schema",
          errors: validation.error.flatten(),
          raw_data: parsedJson,
        },
        { status: 422 }
      );
    }

    const slip: SlipExtraction = validation.data;

    return NextResponse.json({
      success: true,
      data: slip,
      metadata: {
        file_name: fileName,
        mime_type: mimeType,
        sha256,
        size_bytes: imageBuffer.length,
        extracted_at: new Date().toISOString(),
      },
    });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json(
      { success: false, message: `เกิดข้อผิดพลาดในการประมวลผล: ${errorMsg}` },
      { status: 500 }
    );
  }
}
