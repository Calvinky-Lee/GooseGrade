'use client';

import { useState, useEffect, use } from 'react';
import { supabase } from '@/lib/supabase/client';
import { ArrowLeft, Calculator, GraduationCap, Save } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// Types
interface Assessment {
  id: string;
  name: string;
  weight: number;
  grade?: number; // User input
}

interface Course {
  id: string;
  code: string;
  name: string;
  term: string;
  assessments: Assessment[];
}

export default function CoursePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params); // Unwrapping params for Next.js 15+
  const router = useRouter();
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [targetGrade, setTargetGrade] = useState<number | ''>('');

  // Fetch Data
  useEffect(() => {
    const fetchCourse = async () => {
      const decodedCode = decodeURIComponent(code);
      
      // Get Course
      const { data: courseData, error } = await supabase
        .from('courses')
        .select('*')
        .eq('code', decodedCode)
        .order('term_date', { ascending: false }) // Get latest term
        .limit(1)
        .single();

      if (error || !courseData) {
        console.error('Course not found', error);
        setLoading(false);
        return;
      }

      // Get Assessments
      const { data: assessmentData } = await supabase
        .from('assessments')
        .select('*')
        .eq('course_id', courseData.id)
        .order('order_index', { ascending: true });

      setCourse(courseData);
      setAssessments(assessmentData || []);
      setLoading(false);
    };

    fetchCourse();
  }, [code]);

  // Calculation Logic
  const calculateCurrentGrade = () => {
    let totalWeight = 0;
    let earnedWeight = 0;

    assessments.forEach(a => {
      if (a.grade !== undefined && a.grade !== null && !isNaN(a.grade)) {
        totalWeight += a.weight;
        earnedWeight += (a.grade / 100) * a.weight;
      }
    });

    if (totalWeight === 0) return 0;
    return (earnedWeight / totalWeight) * 100;
  };

  const calculateRequiredForTarget = () => {
    if (!targetGrade || isNaN(Number(targetGrade))) return null;
    
    let earnedWeight = 0;
    let completedWeight = 0;
    let remainingWeight = 0;

    assessments.forEach(a => {
      if (a.grade !== undefined && a.grade !== null && !isNaN(a.grade)) {
        completedWeight += a.weight;
        earnedWeight += (a.grade / 100) * a.weight;
      } else {
        remainingWeight += a.weight;
      }
    });

    // Formula: (Target - Earned) / Remaining
    const targetPoints = Number(targetGrade); // e.g. 80
    // Earned points e.g. 40 (50% of 80 weight)
    
    if (remainingWeight === 0) return null; // Course complete

    const neededPoints = targetPoints - earnedWeight;
    const neededPercent = (neededPoints / remainingWeight) * 100;

    return Math.max(0, neededPercent);
  };

  const currentGrade = calculateCurrentGrade();
  const requiredGrade = calculateRequiredForTarget();
  const totalProgress = assessments.reduce((sum, a) => 
    (a.grade !== undefined && !isNaN(a.grade)) ? sum + a.weight : sum, 0
  );

  const handleGradeChange = (id: string, val: string) => {
    const num = parseFloat(val);
    setAssessments(prev => prev.map(a => 
      a.id === id ? { ...a, grade: isNaN(num) ? undefined : num } : a
    ));
  };

  if (loading) return <div className="p-10 text-center">Loading course data...</div>;
  if (!course) return <div className="p-10 text-center">Course not found. <Link href="/" className="text-primary underline">Go Home</Link></div>;

  return (
    <div className="max-w-4xl mx-auto pb-20">
      <Link href="/" className="inline-flex items-center text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft className="w-4 h-4 mr-2" /> Back to Search
      </Link>

      <header className="mb-8">
        <h1 className="text-3xl font-bold">{course.code}</h1>
        <h2 className="text-xl text-muted-foreground">{course.name}</h2>
        <div className="inline-block bg-secondary px-3 py-1 rounded-full text-sm font-medium mt-2">
          {course.term}
        </div>
      </header>

      <div className="grid md:grid-cols-3 gap-8">
        {/* Main Assessment List */}
        <div className="md:col-span-2 space-y-6">
          <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
            <div className="bg-muted/30 px-6 py-4 border-b flex justify-between items-center">
              <h3 className="font-semibold flex items-center">
                <Calculator className="w-4 h-4 mr-2" /> Assessments
              </h3>
              <span className="text-sm text-muted-foreground">Weight: 100%</span>
            </div>
            
            <div className="divide-y">
              {assessments.map((assessment) => (
                <div key={assessment.id} className="px-6 py-4 flex items-center gap-4 hover:bg-accent/5 transition-colors">
                  <div className="flex-1">
                    <div className="font-medium">{assessment.name}</div>
                    <div className="text-sm text-muted-foreground">{assessment.weight}% weight</div>
                  </div>
                  <div className="w-24">
                    <input
                      type="number"
                      placeholder="Grade %"
                      className="w-full px-3 py-2 rounded-md border text-right focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                      min="0"
                      max="100"
                      value={assessment.grade ?? ''}
                      onChange={(e) => handleGradeChange(assessment.id, e.target.value)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Stats Sidebar */}
        <div className="space-y-6">
          {/* Current Grade Card */}
          <div className="bg-card border rounded-xl shadow-sm p-6">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">Current Grade</h3>
            <div className="flex items-baseline gap-2">
              <span className={`text-5xl font-bold ${currentGrade >= 80 ? 'text-green-600' : currentGrade >= 60 ? 'text-primary' : 'text-orange-500'}`}>
                {currentGrade.toFixed(1)}%
              </span>
            </div>
            <div className="mt-4 h-2 bg-secondary rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary transition-all duration-500" 
                style={{ width: `${currentGrade}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Based on {totalProgress.toFixed(0)}% completed work
            </p>
          </div>

          {/* Target Grade Card */}
          <div className="bg-card border rounded-xl shadow-sm p-6">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center">
              <GraduationCap className="w-4 h-4 mr-2" /> Target Calculator
            </h3>
            
            <div className="flex items-center gap-3 mb-4">
              <span className="text-sm">I want a</span>
              <input 
                type="number" 
                className="w-20 px-2 py-1 border rounded text-center font-bold"
                placeholder="85"
                value={targetGrade}
                onChange={(e) => setTargetGrade(e.target.value ? parseFloat(e.target.value) : '')}
              />
              <span className="text-sm">% final.</span>
            </div>

            {requiredGrade !== null && (
              <div className={`p-4 rounded-lg ${requiredGrade > 100 ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
                <div className="text-sm font-medium mb-1">
                  {requiredGrade > 100 ? 'Impossible!' : 'You need to average:'}
                </div>
                <div className="text-3xl font-bold">
                  {requiredGrade > 100 ? '>100%' : `${requiredGrade.toFixed(1)}%`}
                </div>
                <div className="text-xs mt-1 opacity-80">
                  on remaining assessments
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

