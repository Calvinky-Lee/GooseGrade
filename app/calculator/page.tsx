import { GradeCalculator } from "@/components/grade-calculator";
import Link from "next/link";
export default function CalculatorPage() {
  return (
    <main className="page-shell course-page">
      <Link href="/#courses" className="back-link">
        ← Back to courses
      </Link>
      <div className="course-heading">
        <span className="eyebrow">A CLEAN SLATE</span>
        <h1>Your course. Your numbers.</h1>
        <p>Build a grading scheme from your outline and see where you stand.</p>
      </div>
      <GradeCalculator />
    </main>
  );
}
