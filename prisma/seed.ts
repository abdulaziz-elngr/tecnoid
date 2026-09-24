/**
 * TecnoID seed script — DEVELOPMENT / DEMO DATA ONLY.
 *
 * Creates:
 *  - A demo Organization → Center → Branch
 *  - All default roles with the permission catalog wired up
 *  - A few demo users (one per key role), each with a real Argon2id hash
 *  - A demo academic level, subject, room and group
 *  - A handful of demo students
 *
 * Run with: npm run db:seed
 *
 * DO NOT run this against a production database. Every record here
 * is clearly demo data (see the "Demo" prefixes) and must not be
 * relied on as real tenant data.
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/password";
import { ALL_PERMISSION_KEYS, DEFAULT_ROLE_PERMISSIONS } from "../src/lib/permissions";
import { generateStudentCode, buildQrPayload } from "../src/lib/student-code";
import { DEFAULT_TEMPLATES } from "../src/lib/templates";

const db = new PrismaClient();

async function main() {
  console.log("Seeding TecnoID demo data...");

  const org = await db.organization.upsert({
    where: { slug: "demo-org" },
    update: {},
    create: { name: "Demo Educational Group", slug: "demo-org" }
  });

  const center = await db.center.create({
    data: {
      organizationId: org.id,
      name: "Demo Learning Center",
      currency: "EGP",
      timezone: "Africa/Cairo"
    }
  });

  const branch = await db.branch.create({
    data: { centerId: center.id, name: "Main Branch", address: "Demo Street 1" }
  });

  const room = await db.room.create({
    data: { branchId: branch.id, name: "Room 101", capacity: 25 }
  });

  // --- Permission catalog ---
  await db.permission.createMany({
    data: ALL_PERMISSION_KEYS.map((key) => ({
      key,
      module: key.split(".")[0] ?? key
    })),
    skipDuplicates: true
  });
  const allPermissions = await db.permission.findMany();
  const permissionByKey = new Map(allPermissions.map((p) => [p.key, p.id]));

  // --- Roles + role-permission mapping ---
  const roleIdByName = new Map<string, string>();
  for (const [roleName, permissionKeys] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const role = await db.role.create({
      data: { organizationId: org.id, name: roleName, isSystem: true }
    });
    roleIdByName.set(roleName, role.id);

    await db.rolePermission.createMany({
      data: permissionKeys
        .map((key) => permissionByKey.get(key))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true
    });
  }

  // --- Demo users (one per key role) ---
  const demoUsers = [
    { name: "Demo Owner", email: "owner@demo.tecnoid.local", role: "CENTER_OWNER" },
    { name: "Demo Manager", email: "manager@demo.tecnoid.local", role: "MANAGER" },
    { name: "Demo Teacher", email: "teacher@demo.tecnoid.local", role: "TEACHER" },
    { name: "Demo Receptionist", email: "reception@demo.tecnoid.local", role: "RECEPTIONIST" }
  ];
  const demoPassword = "Demo#Pass123"; // demo only — rotate before any real use

  for (const u of demoUsers) {
    const passwordHash = await hashPassword(demoPassword);
    const user = await db.user.create({
      data: {
        organizationId: org.id,
        fullName: u.name,
        email: u.email,
        passwordHash
      }
    });
    const roleId = roleIdByName.get(u.role);
    if (roleId) {
      await db.userRole.create({ data: { userId: user.id, roleId } });
    }
    if (u.role !== "CENTER_OWNER" && u.role !== "MANAGER") {
      await db.userBranch.create({ data: { userId: user.id, branchId: branch.id } });
    }
  }

  // --- Academic structure ---
  const level = await db.academicLevel.create({
    data: { organizationId: org.id, name: "Preparatory", order: 1 }
  });
  const grade = await db.academicGrade.create({
    data: { levelId: level.id, name: "Preparatory 1", order: 1 }
  });
  const subject = await db.subject.create({
    data: { organizationId: org.id, name: "Mathematics", academicLevelId: level.id, academicGradeId: grade.id }
  });

  // --- Demo teacher + assistant ---
  const teacher = await db.teacher.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      fullName: "Demo Teacher",
      phone: "+201000000001",
      isAssistant: false
    }
  });
  const assistant = await db.teacher.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      fullName: "Demo Assistant",
      phone: "+201000000002",
      isAssistant: true
    }
  });

  const group = await db.group.create({
    data: {
      branchId: branch.id,
      subjectId: subject.id,
      academicLevelId: level.id,
      academicGradeId: grade.id,
      roomId: room.id,
      teacherId: teacher.id,
      assistantId: assistant.id,
      name: "Math A1",
      capacity: 20
    }
  });

  // --- Demo students + parents ---
  const demoStudentNames = ["Ahmed Mohamed", "Sara Ali", "Youssef Hassan", "Mariam Adel"];
  let parentPhoneCounter = 1;
  const students: { id: string; fullName: string }[] = [];
  for (const fullName of demoStudentNames) {
    const studentCode = await generateStudentCode();
    const student = await db.student.create({
      data: {
        organizationId: org.id,
        branchId: branch.id,
        studentCode,
        qrCode: buildQrPayload(studentCode),
        fullName,
        gender: "MALE",
        academicLevelId: level.id,
        primaryGroupId: group.id
      }
    });
    students.push({ id: student.id, fullName: student.fullName });
    await db.groupStudent.create({
      data: { groupId: group.id, studentId: student.id, isPrimary: true }
    });

    const parent = await db.parent.create({
      data: {
        fullName: `Parent of ${fullName}`,
        phone: `+2010000${String(1000 + parentPhoneCounter).slice(-4)}`,
        whatsappNumber: `+2010000${String(1000 + parentPhoneCounter).slice(-4)}`,
        preferredLanguage: "ar"
      }
    });
    parentPhoneCounter += 1;
    await db.studentParent.create({
      data: { studentId: student.id, parentId: parent.id, relationship: "Father", isPrimary: true }
    });
  }

  // --- Demo schedule slots ---
  await db.schedule.create({
    data: { groupId: group.id, dayOfWeek: "SUNDAY", startMinutes: 16 * 60, endMinutes: 17 * 60 + 30 }
  });
  await db.schedule.create({
    data: { groupId: group.id, dayOfWeek: "TUESDAY", startMinutes: 16 * 60, endMinutes: 17 * 60 + 30 }
  });

  // ==========================================================
  // PHASE 5 — CLASS SESSIONS & ATTENDANCE
  // ==========================================================
  console.log("Seeding sessions and attendance (Phase 5)...");

  const attendanceTypes: ("REGULAR" | "LATE" | "ABSENT" | "MAKE_UP" | "EXCUSED")[] = [
    "REGULAR",
    "LATE",
    "ABSENT",
    "REGULAR"
  ];
  const sessions: { id: string; date: Date }[] = [];
  for (let weekOffset = 3; weekOffset >= 0; weekOffset -= 1) {
    const sessionDate = new Date();
    sessionDate.setDate(sessionDate.getDate() - weekOffset * 7);
    sessionDate.setHours(0, 0, 0, 0);

    const session = await db.classSession.create({
      data: {
        organizationId: org.id,
        branchId: branch.id,
        groupId: group.id,
        teacherId: teacher.id,
        roomId: room.id,
        date: sessionDate,
        startMinutes: 16 * 60,
        endMinutes: 17 * 60 + 30,
        status: weekOffset === 0 ? "OPEN" : "COMPLETED"
      }
    });
    sessions.push({ id: session.id, date: sessionDate });

    for (const [index, student] of students.entries()) {
      const type = attendanceTypes[index % attendanceTypes.length]!;
      await db.attendance.create({
        data: {
          organizationId: org.id,
          branchId: branch.id,
          sessionId: session.id,
          studentId: student.id,
          groupId: group.id,
          type,
          makeUpReason: type === "MAKE_UP" ? "Approved catch-up for a missed session" : undefined
        }
      });
    }
  }

  // ==========================================================
  // PHASE 6 — EXAMS, RECITATION, ASSIGNMENTS
  // ==========================================================
  console.log("Seeding exams, recitation and assignments (Phase 6)...");

  const exam = await db.exam.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      subjectId: subject.id,
      groupId: group.id,
      name: "Unit 1 Test",
      date: new Date(),
      maxScore: 20,
      durationMinutes: 45,
      isPublished: true,
      publishedAt: new Date()
    }
  });
  const examScores = [18, 15, 9, 20];
  for (const [index, student] of students.entries()) {
    await db.examResult.create({
      data: { examId: exam.id, studentId: student.id, score: examScores[index % examScores.length]! }
    });
  }

  for (const student of students) {
    await db.recitation.create({
      data: {
        organizationId: org.id,
        studentId: student.id,
        subjectId: subject.id,
        groupId: group.id,
        teacherId: teacher.id,
        date: new Date(),
        content: "Chapter 1, pages 1-10",
        score: 8,
        maxScore: 10,
        status: "COMPLETED"
      }
    });
  }

  const assignment = await db.assignment.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      groupId: group.id,
      subjectId: subject.id,
      title: "Homework 1",
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      maxScore: 10
    }
  });
  for (const [index, student] of students.entries()) {
    await db.assignmentSubmission.create({
      data: {
        assignmentId: assignment.id,
        studentId: student.id,
        status: index === 0 ? "GRADED" : "PENDING",
        grade: index === 0 ? 9 : undefined
      }
    });
  }

  // ==========================================================
  // PHASE 7 — SUBSCRIPTIONS, PAYMENTS, INVOICES
  // ==========================================================
  console.log("Seeding subscriptions, payments and invoices (Phase 7)...");

  const now = new Date();
  const monthlyAmount = 300;
  for (const [index, student] of students.entries()) {
    const subscription = await db.subscription.create({
      data: {
        organizationId: org.id,
        branchId: branch.id,
        studentId: student.id,
        groupId: group.id,
        subjectId: subject.id,
        periodYear: now.getFullYear(),
        periodMonth: now.getMonth() + 1,
        amount: monthlyAmount,
        dueDate: new Date(now.getFullYear(), now.getMonth(), 10),
        status: index % 2 === 0 ? "PAID" : "UNPAID"
      }
    });

    // First two students have already paid — give them a receipt + invoice.
    if (index % 2 === 0) {
      const receiptNumber = `RCPT-DEMO-${String(index + 1).padStart(4, "0")}`;
      const payment = await db.payment.create({
        data: {
          organizationId: org.id,
          branchId: branch.id,
          studentId: student.id,
          amount: monthlyAmount,
          method: "CASH",
          receiptNumber
        }
      });
      await db.paymentAllocation.create({
        data: { paymentId: payment.id, subscriptionId: subscription.id, amount: monthlyAmount }
      });
      await db.subscription.update({
        where: { id: subscription.id },
        data: { paidAmount: monthlyAmount, status: "PAID" }
      });
      await db.invoice.create({
        data: {
          organizationId: org.id,
          invoiceNumber: `INV-DEMO-${String(index + 1).padStart(4, "0")}`,
          paymentId: payment.id,
          studentId: student.id,
          totalAmount: monthlyAmount,
          paidAmount: monthlyAmount,
          remainingAmount: 0,
          description: `Tuition — ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
        }
      });
    }
  }

  // ==========================================================
  // PHASE 8 — EXPENSES & UTILITIES
  // ==========================================================
  console.log("Seeding expenses and utility bills (Phase 8)...");

  await db.expense.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      category: "SUPPLIES",
      amount: 450,
      spentAt: new Date(),
      vendor: "Demo Stationery Store",
      method: "CASH"
    }
  });
  await db.expense.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      category: "MAINTENANCE",
      amount: 200,
      spentAt: new Date(),
      vendor: "Demo Maintenance Co.",
      method: "BANK_TRANSFER"
    }
  });

  await db.utilityBill.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      type: "ELECTRICITY",
      meterNumber: "EL-100234",
      periodStart: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      periodEnd: new Date(now.getFullYear(), now.getMonth(), 0),
      previousReading: 1000,
      currentReading: 1250,
      consumption: 250,
      amount: 375,
      dueDate: new Date(now.getFullYear(), now.getMonth(), 15),
      status: "UNPAID"
    }
  });

  const employee = await db.employee.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      fullName: "Demo Front Desk",
      phone: "+201000000010",
      position: "Receptionist",
      hireDate: new Date(now.getFullYear() - 1, 0, 1)
    }
  });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const checkIn = new Date(today);
  checkIn.setHours(9, 5, 0, 0);
  await db.employeeAttendance.create({
    data: {
      organizationId: org.id,
      branchId: branch.id,
      employeeId: employee.id,
      date: today,
      checkInAt: checkIn,
      status: "LATE",
      lateMinutes: 5
    }
  });

  // ==========================================================
  // PHASE 9 — NOTIFICATION TEMPLATES & RULES
  // ==========================================================
  console.log("Seeding notification templates and rules (Phase 9)...");

  for (const template of DEFAULT_TEMPLATES) {
    for (const locale of ["ar", "en"] as const) {
      await db.notificationTemplate.upsert({
        where: {
          organizationId_key_locale_channel: {
            organizationId: org.id,
            key: template.key,
            locale,
            channel: "WHATSAPP"
          }
        },
        update: {},
        create: {
          organizationId: org.id,
          key: template.key,
          locale,
          channel: "WHATSAPP",
          type: template.type,
          name: template.name,
          body: locale === "ar" ? template.ar : template.en
        }
      });
    }
  }

  const defaultRules: { event: "STUDENT_ABSENT" | "STUDENT_LATE" | "PAYMENT_OVERDUE" | "PAYMENT_RECEIVED" | "EXAM_PUBLISHED"; templateKey: string }[] =
    [
      { event: "STUDENT_ABSENT", templateKey: "attendance.absent" },
      { event: "STUDENT_LATE", templateKey: "attendance.late" },
      { event: "PAYMENT_OVERDUE", templateKey: "payment.reminder" },
      { event: "PAYMENT_RECEIVED", templateKey: "payment.received" },
      { event: "EXAM_PUBLISHED", templateKey: "exam.result" }
    ];
  for (const rule of defaultRules) {
    await db.notificationRule.upsert({
      where: { organizationId_event_channel: { organizationId: org.id, event: rule.event, channel: "WHATSAPP" } },
      update: {},
      create: {
        organizationId: org.id,
        event: rule.event,
        channel: "WHATSAPP",
        templateKey: rule.templateKey
      }
    });
  }

  console.log("Seed complete.");
  console.log("Demo login (all roles use the same password):");
  for (const u of demoUsers) console.log(`  ${u.email} / ${demoPassword}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
