import { promises as fs } from 'fs';
import path from 'path';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];
    if (files.length === 0) {
      return new Response(JSON.stringify({ success: false, message: 'No files uploaded' }), { status: 400 });
    }
    const baseDir = path.join(process.cwd(), 'RAWFILE');
    await fs.mkdir(baseDir, { recursive: true });
    for (const file of files) {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const filePath = path.join(baseDir, file.name);
      await fs.writeFile(filePath, buffer);
    }
    return new Response(JSON.stringify({ success: true, message: `${files.length} file(s) uploaded` }), { status: 200 });
  } catch (error) {
    console.error('Upload error:', error);
    return new Response(JSON.stringify({ success: false, message: 'Upload failed' }), { status: 500 });
  }
}
