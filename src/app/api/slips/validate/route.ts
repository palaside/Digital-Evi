import { NextResponse } from "next/server";
import { SlipExtractionSchema } from "@/schemas/slip.schema";

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const result = SlipExtractionSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          message: "ข้อมูลสลิปไม่ผ่านการตรวจสอบ",
          errors: result.error.flatten(),
        },
        {
          status: 422,
        }
      );
    }

    return NextResponse.json({
      success: true,
      data: result.data,
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Invalid JSON payload";
    return NextResponse.json(
      {
        success: false,
        message: errorMessage,
      },
      {
        status: 400,
      }
    );
  }
}
