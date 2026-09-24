import Link from "next/link";

export default function AcademicHubPage() {
  return (
    <div>
      <h1 className="mb-4 text-xl font-bold">Academic</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/dashboard/academic/levels" className="card block p-5 hover:border-tecno-gold">
          <h2 className="font-semibold">Stages &amp; Grades</h2>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Manage educational stages and the grades within each one — the root of the
            Stage → Grade → Subject → Group chain.
          </p>
        </Link>
        <Link href="/dashboard/academic/subjects" className="card block p-5 hover:border-tecno-gold">
          <h2 className="font-semibold">Subjects</h2>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Every subject belongs to one Stage and one Grade.
          </p>
        </Link>
        <Link href="/dashboard/academic/groups" className="card block p-5 hover:border-tecno-gold">
          <h2 className="font-semibold">Groups</h2>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Groups link a Stage, Grade and Subject to a roster of students, a classroom, and a
            teacher — with real classroom-capacity validation.
          </p>
        </Link>
        <Link href="/dashboard/academic/schedule" className="card block p-5 hover:border-tecno-gold">
          <h2 className="font-semibold">Schedule</h2>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Manage weekly time slots per group, with automatic teacher/room/group
            conflict prevention, enriched details, and filters.
          </p>
        </Link>
        <Link href="/dashboard/academic/rooms" className="card block p-5 hover:border-tecno-gold">
          <h2 className="font-semibold">Classrooms</h2>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Classroom capacity, current students, available seats and assigned groups.
          </p>
        </Link>
        <Link href="/dashboard/academic/sessions" className="card block p-5 hover:border-tecno-gold">
          <h2 className="font-semibold">Sessions</h2>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Dated class sessions generated from the weekly schedule.
          </p>
        </Link>
      </div>
    </div>
  );
}
