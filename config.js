// ไฟล์ตั้งค่าร้าน: ปกติแก้แค่ไฟล์นี้
// supabaseUrl ว่าง = โหมดเดโม (ข้อมูลเก็บในเบราว์เซอร์เครื่องนี้เท่านั้น)
window.APP_CONFIG = {
  shopName: "ມິນິມາດ",
  supabaseUrl: "https://hyfzbfpnwkpjqksdujwt.supabase.co",
  // anon key เป็นคีย์สาธารณะ ใส่ในเว็บได้ (สิทธิ์คุมด้วย RLS) · ห้ามใส่ service_role key ที่นี่
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh5ZnpiZnBud2twanFrc2R1and0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1NzUyMzEsImV4cCI6MjEwODE1MTIzMX0.2qkL65-6usQVvV-Zjj_ZhlLG7H3VGZKnn5jTN1-2beA",
  // ผู้ใช้ล็อกอินด้วยชื่อสั้น ๆ เช่น "kaew" → ระบบแปลงเป็น kaew@minimart.local
  loginDomain: "minimart.local",
  defaultLang: "lo",
  // รูป QR รับเงินของร้าน (เช่น "assets/qr.jpg") ว่าง = ยังไม่มี
  qrImage: "",
  storageKey: "minimart-pos-v1",
};
