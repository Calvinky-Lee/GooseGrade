import { Suspense } from "react";
import { CourseDetail } from "@/components/course-detail";
export default async function CoursePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return (
    <Suspense fallback={<p className="loading-message">Loading course…</p>}>
      <CourseDetail code={decodeURIComponent(code)} />
    </Suspense>
  );
}
