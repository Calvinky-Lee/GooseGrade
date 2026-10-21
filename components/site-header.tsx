"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
export function SiteHeader() {
  const path = usePathname();
  return (
    <header className="site-header">
      <Link href="/" className="brand" aria-label="GooseGrade home">
        <Image src="/goosegrade.png" width={40} height={40} alt="" priority />
        <span>
          GooseGrade<span className="brand-period">.</span>
        </span>
      </Link>
      <nav aria-label="Main navigation">
        <Link href="/#courses" aria-current={path === "/" ? "page" : undefined}>
          Courses
        </Link>
        <Link
          className="nav-calculator"
          href="/calculator"
          aria-current={path === "/calculator" ? "page" : undefined}
        >
          Custom calculator <ArrowUpRight size={16} />
        </Link>
      </nav>
    </header>
  );
}
