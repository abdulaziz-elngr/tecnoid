import { describe, expect, it } from "vitest";
import {
  normalizeEgyptianPhone,
  buildWhatsAppLink,
  renderWhatsAppTemplate,
  resolveParentWhatsApp,
} from "./whatsapp-link";

describe("normalizeEgyptianPhone", () => {
  it("converts a local 01xxxxxxxxx number to 20xxxxxxxxxx", () => {
    expect(normalizeEgyptianPhone("01012345678")).toBe("201012345678");
  });

  it("strips a leading + and spaces", () => {
    expect(normalizeEgyptianPhone("+20 101 234 5678")).toBe("201012345678");
  });

  it("accepts a number already in international form with no separators", () => {
    expect(normalizeEgyptianPhone("201012345678")).toBe("201012345678");
  });

  it("accepts all four Egyptian mobile prefixes", () => {
    expect(normalizeEgyptianPhone("01112345678")).toBe("201112345678");
    expect(normalizeEgyptianPhone("01212345678")).toBe("201212345678");
    expect(normalizeEgyptianPhone("01512345678")).toBe("201512345678");
  });

  it("returns null for missing, empty or non-Egyptian-mobile input", () => {
    expect(normalizeEgyptianPhone(null)).toBeNull();
    expect(normalizeEgyptianPhone(undefined)).toBeNull();
    expect(normalizeEgyptianPhone("")).toBeNull();
    expect(normalizeEgyptianPhone("0212345678")).toBeNull(); // landline, not mobile
    expect(normalizeEgyptianPhone("123")).toBeNull();
  });
});

describe("buildWhatsAppLink", () => {
  it("builds a wa.me URL with no plus sign and a URL-encoded message", () => {
    const url = buildWhatsAppLink("201012345678", "hello world");
    expect(url).toBe("https://wa.me/201012345678?text=hello%20world");
    expect(url).not.toContain("+");
  });

  it("URL-encodes Arabic text correctly", () => {
    const url = buildWhatsAppLink("201012345678", "مرحبا");
    expect(url.startsWith("https://wa.me/201012345678?text=")).toBe(true);
    const encoded = url.split("text=")[1];
    expect(decodeURIComponent(encoded)).toBe("مرحبا");
  });
});

describe("renderWhatsAppTemplate", () => {
  it("fills in the absence template with the given variables", () => {
    const message = renderWhatsAppTemplate("ABSENCE", {
      studentName: "أحمد محمد",
      subjectName: "رياضيات",
      date: "2026-09-20",
      groupName: "Math A1",
    });
    expect(message).toContain("أحمد محمد");
    expect(message).toContain("رياضيات");
    expect(message).toContain("2026-09-20");
    expect(message).toContain("Math A1");
  });

  it("omits the group clause when no group name is given", () => {
    const message = renderWhatsAppTemplate("ABSENCE", {
      studentName: "أحمد",
      subjectName: "رياضيات",
      date: "2026-09-20",
    });
    expect(message).not.toContain("في مجموعة");
  });

  it("fills in the payment reminder template with the student's real name and amount", () => {
    const message = renderWhatsAppTemplate("PAYMENT", {
      studentName: "أحمد محمد",
      amount: "500",
    });
    expect(message).toContain("أحمد محمد");
    expect(message).toContain("500");
    expect(message).toContain("الرسوم المستحقة");
  });

  it("fills in the exam template with all exam details", () => {
    const message = renderWhatsAppTemplate("EXAM", {
      studentName: "سارة أحمد",
      subjectName: "الفيزياء",
      examName: "امتحان الشهر",
      examDate: "2026-10-01",
      examTime: "5:00 PM",
    });
    expect(message).toContain("سارة أحمد");
    expect(message).toContain("الفيزياء");
    expect(message).toContain("امتحان الشهر");
    expect(message).toContain("2026-10-01");
    expect(message).toContain("5:00 PM");
  });

  it("omits the time clause when no exam time is given", () => {
    const message = renderWhatsAppTemplate("EXAM", {
      studentName: "سارة",
      subjectName: "الفيزياء",
      examName: "امتحان",
      examDate: "2026-10-01",
    });
    expect(message).not.toContain("الساعة");
  });

  it("wraps a staff-composed announcement body with the recipient's name", () => {
    const message = renderWhatsAppTemplate("ANNOUNCEMENT", {
      studentName: "أحمد",
      parentName: "محمد",
      message: "غداً إجازة رسمية.",
    });
    expect(message).toContain("أحمد");
    expect(message).toContain("محمد");
    expect(message).toContain("غداً إجازة رسمية.");
  });
});

describe("resolveParentWhatsApp", () => {
  it("prefers the dedicated whatsappNumber field over the general phone", () => {
    const result = resolveParentWhatsApp({
      phone: "01099999999",
      whatsappNumber: "01012345678",
    });
    expect(result.phone).toBe("201012345678");
  });

  it("falls back to the general phone when whatsappNumber is missing", () => {
    const result = resolveParentWhatsApp({
      phone: "01012345678",
      whatsappNumber: null,
    });
    expect(result.phone).toBe("201012345678");
  });

  it("returns a reason instead of a broken link when there is no parent", () => {
    const result = resolveParentWhatsApp(null);
    expect(result.phone).toBeNull();
    expect(result.reason).toBeTruthy();
  });

  it("returns a reason instead of a broken link when the number is invalid", () => {
    const result = resolveParentWhatsApp({
      phone: "123",
      whatsappNumber: null,
    });
    expect(result.phone).toBeNull();
    expect(result.reason).toBeTruthy();
  });
});
