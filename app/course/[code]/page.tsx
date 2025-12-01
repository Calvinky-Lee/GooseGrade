'use client';

import { useState, useEffect, use, useRef } from 'react';
import { supabase } from '@/lib/supabase/client';
import { ChevronDown, ChevronRight, Calculator, GraduationCap, RotateCcw, Plus, Minus, GripVertical } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';

interface Assessment {
  id: string;
  name: string;
  weight: number;
  weightInputValue?: string;
  grade?: number; // User input
  inputValue?: string;
  isGroup?: false;
  order_index?: number;
}

interface Course {
  id: string;
  code: string;
  name: string;
  term: string;
  assessments: Assessment[];
}

interface GroupedAssessment {
  id: string; // Group ID (e.g. "Mobius Assignment")
  name: string;
  isGroup: true;
  children: Assessment[];
  totalWeight: number;
  groupGrade?: string; // The "general" grade entered for the group
}

type DisplayItem = Assessment | GroupedAssessment;

export default function CoursePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialSectionId = searchParams.get('section');
  
  const [course, setCourse] = useState<Course | null>(null);
  const [availableSections, setAvailableSections] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [targetGrade, setTargetGrade] = useState<number | ''>('');
  const [invalidGrades, setInvalidGrades] = useState<Record<string, boolean>>({});
  
  // Drop Feature State
  const [dropMode, setDropMode] = useState<'none' | 'selectSource' | 'selectTarget'>('none');
  const [dropSourceId, setDropSourceId] = useState<string | null>(null);
  const [droppedMap, setDroppedMap] = useState<Record<string, string>>({}); // SourceID -> TargetID
  const [focusedId, setFocusedId] = useState<string | null>(null);
  
  // Remove Feature State
  const [removeMode, setRemoveMode] = useState(false);
  const [removedItems, setRemovedItems] = useState<Set<string>>(new Set()); // IDs of removed items

  // Rename Feature State
  const [editingNameId, setEditingNameId] = useState<{ id: string; isGroup: boolean; groupId?: string } | null>(null);
  const [editingNameValue, setEditingNameValue] = useState<string>('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  // New state for grouping
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [groupGrades, setGroupGrades] = useState<Record<string, string>>({}); // Key: Group Name, Value: Grade Input

  // State for displayed stats (calculated on button press)
  const [displayStats, setDisplayStats] = useState<{
      currentGrade: number;
      requiredGrade: number | null;
      totalProgress: number;
  }>({ currentGrade: 0, requiredGrade: null, totalProgress: 0 });

  // Drag and Drop State
  const [draggedItem, setDraggedItem] = useState<{ id: string; isGroup: boolean; groupId?: string } | null>(null);
  const [dragOverItem, setDragOverItem] = useState<{ id: string; isGroup: boolean; groupId?: string; position?: 'before' | 'after' } | null>(null);
  const [reorderedItems, setReorderedItems] = useState<DisplayItem[] | null>(null); // Optimistic UI state

  // Helper to group assessments
  const groupAssessments = (flatAssessments: Assessment[]): DisplayItem[] => {
    const groups: Record<string, Assessment[]> = {};
    const singles: Assessment[] = [];
    const processedIds = new Set<string>();

    // Helper to pluralize group names
    const pluralize = (name: string) => {
        // Strip any remaining quotes that might have come from DB
        let cleanName = name.replace(/^["“'”]+|["“'”]+$/g, '').trim();
        
        if (cleanName.toLowerCase().endsWith('quiz')) return cleanName + 'zes'; // Quiz -> Quizzes
        if (cleanName.toLowerCase().endsWith('s')) return cleanName; // Already plural
        return cleanName + 's'; // Default add 's'
    };

    // 1. Identify potential groups based on "Name Number" pattern
    flatAssessments.forEach(a => {
        const match = a.name.match(/^(.*?) ?#?\d+/);
        if (match) {
            const baseName = match[1].trim();
            if (baseName) { 
                if (!groups[baseName]) groups[baseName] = [];
                groups[baseName].push(a);
                return; 
            }
        }
        singles.push(a);
    });

    const result: DisplayItem[] = [];

    // 2. Process groups
    Object.entries(groups).forEach(([baseName, items]) => {
        if (items.length > 1) {
            items.forEach(i => processedIds.add(i.id));
            const totalWeight = items.reduce((sum, i) => sum + i.weight, 0);
            result.push({
                id: baseName, 
                name: pluralize(baseName), 
                isGroup: true,
                children: items,
                totalWeight: totalWeight
            });
        }
    });

    // 3. Add singles
    flatAssessments.forEach(a => {
        if (!processedIds.has(a.id)) {
            const exists = result.find(r => !r.isGroup && r.id === a.id);
            if (!exists) result.push(a);
        }
    });

    // Sort by order_index
    return result.sort((a, b) => {
        const indexA = a.isGroup ? (a.children[0] as any).order_index : (a as any).order_index;
        const indexB = b.isGroup ? (b.children[0] as any).order_index : (b as any).order_index;
        return indexA - indexB;
    });
  };

  // Compute Weight Adjustments from DroppedMap
  const DISTRIBUTE_EVENLY_ID = '__DISTRIBUTE_EVENLY__';

  const weightAdjustments = (() => {
      const adjustments: Record<string, number> = {};
      const groups = groupAssessments(assessments); // We need this structure to find source weights
      
      // Helper to find item weight
      const findWeight = (id: string): number => {
          const flat = assessments.find(a => a.id === id);
          if (flat) return flat.weight;
          const group = groups.find(g => g.id === id);
          if (group && 'totalWeight' in group) return group.totalWeight;
          return 0;
      };

      Object.entries(droppedMap).forEach(([sourceId, targetId]) => {
          const w = findWeight(sourceId);
          
          if (targetId === DISTRIBUTE_EVENLY_ID) {
              const activeRecipients = assessments.filter(a => {
                  if (a.id === sourceId) return false;
                  if (droppedMap[a.id]) return false;
                  
                  // Check if child of source group
                  const sourceGroup = groups.find(g => g.id === sourceId);
                  if (sourceGroup && sourceGroup.isGroup) {
                      if (sourceGroup.children.some(c => c.id === a.id)) return false;
                  }
                  
                  // Check if child of any dropped group
                  const parentGroup = groups.find(g => g.isGroup && g.children.some(c => c.id === a.id));
                  if (parentGroup && droppedMap[parentGroup.id]) return false;
                  
                  return true;
              });
              
              if (activeRecipients.length > 0) {
                  const share = w / activeRecipients.length;
                  activeRecipients.forEach(a => {
                      adjustments[a.id] = (adjustments[a.id] || 0) + share;
                  });
              }
          } else {
              adjustments[targetId] = (adjustments[targetId] || 0) + w;
          }
      });
      return adjustments;
  })();

  // Fetch Data
  useEffect(() => {
    const fetchCourse = async () => {
      const decodedCode = decodeURIComponent(code);
      console.log('Fetching course for code:', decodedCode);

      const { data: coursesData, error } = await supabase
        .from('courses')
        .select('*')
        .eq('code', decodedCode)
        .order('term_date', { ascending: false });

      if (error || !coursesData || coursesData.length === 0) {
        console.error('Course not found', error);
        setLoading(false);
        return;
      }
      
      const latestTerm = coursesData[0].term;
      const latestCourses = coursesData.filter(c => c.term === latestTerm);
      
      setAvailableSections(latestCourses);
      
      let selectedCourse = latestCourses[0];
      if (initialSectionId) {
        const urlSelected = latestCourses.find(c => c.id === initialSectionId);
        if (urlSelected) selectedCourse = urlSelected;
      }

      const { data: assessmentData } = await supabase
        .from('assessments')
        .select('*')
        .eq('course_id', selectedCourse.id)
        .order('order_index', { ascending: true });

      setCourse(selectedCourse);
      
      let processedAssessments = (assessmentData || []).map((assessment) => ({
          ...assessment,
          inputValue: typeof assessment.grade === 'number' ? assessment.grade.toString() : '',
          weightInputValue: Number.isInteger(assessment.weight) 
            ? assessment.weight.toString() 
            : Number(assessment.weight).toFixed(5).replace(/\.?0+$/, ''),
        }));

      processedAssessments = processedAssessments.filter(a => a.weight > 0);

      // Sort by order_index first (if available), then by name type as fallback
      processedAssessments.sort((a, b) => {
          const orderA = a.order_index || 0;
          const orderB = b.order_index || 0;
          
          // If both have order_index and they differ, use that
          if (orderA !== orderB && orderA > 0 && orderB > 0) {
              return orderA - orderB;
          }
          
          // Otherwise fall back to name-based sorting
          const getScore = (name: string) => {
              const lower = name.toLowerCase();
              if (lower.includes('final') && (lower.includes('exam') || lower.includes('examination') || lower.includes('assessment'))) return 3;
              if (lower.includes('midterm')) return 2;
              if (lower.includes('assignment') || lower.includes('quiz') || lower.includes('lab')) return 1;
              return 1.5; 
          };
          const scoreA = getScore(a.name);
          const scoreB = getScore(b.name);
          
          if (scoreA !== scoreB) return scoreA - scoreB;
          return 0; 
      });

      setAssessments(processedAssessments);
      setLoading(false);
    };

    fetchCourse();
  }, [code]);

  const handleSectionChange = async (sectionId: string) => {
      setLoading(true);
      const newCourse = availableSections.find(c => c.id === sectionId);
      if (!newCourse) return;

      const { data: assessmentData } = await supabase
        .from('assessments')
        .select('*')
        .eq('course_id', sectionId)
        .order('order_index', { ascending: true });
        
      setCourse(newCourse);
      
      let processedAssessments = (assessmentData || []).map((assessment) => ({
          ...assessment,
          inputValue: '',
          weightInputValue: Number.isInteger(assessment.weight) 
            ? assessment.weight.toString() 
            : Number(assessment.weight).toFixed(5).replace(/\.?0+$/, ''),
        }));

      processedAssessments = processedAssessments.filter(a => a.weight > 0);

      // Sort by order_index first (if available), then by name type as fallback
      processedAssessments.sort((a, b) => {
          const orderA = a.order_index || 0;
          const orderB = b.order_index || 0;
          
          // If both have order_index and they differ, use that
          if (orderA !== orderB && orderA > 0 && orderB > 0) {
              return orderA - orderB;
          }
          
          // Otherwise fall back to name-based sorting
          const getScore = (name: string) => {
              const lower = name.toLowerCase();
              if (lower.includes('final') && (lower.includes('exam') || lower.includes('examination') || lower.includes('assessment'))) return 3;
              if (lower.includes('midterm')) return 2;
              if (lower.includes('assignment') || lower.includes('quiz') || lower.includes('lab')) return 1;
              return 1.5; 
          };
          const scoreA = getScore(a.name);
          const scoreB = getScore(b.name);
          
          if (scoreA !== scoreB) return scoreA - scoreB;
          return 0; 
      });

      setAssessments(processedAssessments);
      setDisplayStats({ currentGrade: 0, requiredGrade: null, totalProgress: 0 });
      setLoading(false);
  };

  // Drop Feature Handlers
  const handleDropButtonClick = () => {
    if (dropMode === 'none') {
      setDropMode('selectSource');
    } else {
      setDropMode('none');
      setDropSourceId(null);
    }
  };

  const handleItemClick = (item: DisplayItem) => {
    if (dropMode === 'none') return;

    const itemId = item.id;
    
    if (dropMode === 'selectSource') {
      if (droppedMap[itemId]) return; // Already dropped
      
      setDropSourceId(itemId);
      setDropMode('selectTarget');
    } else if (dropMode === 'selectTarget') {
      if (itemId === dropSourceId || droppedMap[itemId]) return;
      
      // Check for same-group transfer
      const groups = groupAssessments(assessments);
      
      let sourceGroupId: string | undefined;
      const sourceGroupObj = groups.find(g => g.id === dropSourceId);
      if (sourceGroupObj) {
          sourceGroupId = sourceGroupObj.id;
      } else {
          const parent = groups.find(g => g.isGroup && g.children.some(c => c.id === dropSourceId));
          if (parent) sourceGroupId = parent.id;
      }

      let targetGroupId: string | undefined;
      const targetGroupObj = groups.find(g => g.id === itemId);
      if (targetGroupObj) {
          targetGroupId = targetGroupObj.id;
      } else {
          const parent = groups.find(g => g.isGroup && g.children.some(c => c.id === itemId));
          if (parent) targetGroupId = parent.id;
      }
      
      console.log('Transfer check:', { 
          dropSourceId, 
          itemId, 
          sourceGroupId, 
          targetGroupId,
          sourceIsGroup: !!sourceGroupObj,
          targetIsGroup: !!targetGroupObj
      });

      if (sourceGroupId && targetGroupId && sourceGroupId === targetGroupId) {
           // Allow Child -> Parent transfer (Redistribute within group)
           const isChildToParent = !sourceGroupObj && targetGroupObj;
           
           if (!isChildToParent) {
               alert("Cannot transfer weight to specific items within the same section. To redistribute weight among remaining items, select the Section Header.");
               return;
           }
      }

      // Perform Transfer
      setDroppedMap(prev => ({
          ...prev,
          [dropSourceId!]: itemId
      }));
      
      setDropMode('none');
      setDropSourceId(null);
    }
  };

  const handleUndrop = (sourceId: string) => {
      if (dropMode !== 'none') return;
      
      setDroppedMap(prev => {
          const next = { ...prev };
          delete next[sourceId];
          return next;
      });
  };

  const handleDistributeEvenly = () => {
    if (!dropSourceId) return;
    setDroppedMap(prev => ({
        ...prev,
        [dropSourceId]: DISTRIBUTE_EVENLY_ID
    }));
    setDropMode('none');
    setDropSourceId(null);
  };

  // Get effective weight (original + adjustments)
  // For groups: base is sum of active children. Adjustment is added to that.
  // For children: base is own weight. IF group has adjustment, it is distributed among active children.
  const getEffectiveWeight = (item: DisplayItem) => {
      if (item.isGroup) {
          // Group effective weight = Sum of active children + Group Adjustment
          // This is calculated in the render loop mostly, but here for calculation functions
          let activeChildrenSum = 0;
          item.children.forEach(child => {
              if (!droppedMap[child.id]) activeChildrenSum += child.weight; // Base weights
          });
          const groupAdjustment = weightAdjustments[item.id] || 0;
          return activeChildrenSum + groupAdjustment;
      } else {
          // Single item (or child treated as single in flat list?)
          // If it's a child of a group, we need to know its group to check for distribution.
          // But 'assessments' is flat. 'groupAssessments' builds hierarchy.
          // We need to find the parent group to calculate distribution.
          // This is expensive to do per item if we don't have the map.
          // But we can rely on the 'groups' structure in the main loops.
          
          // Fallback for flat access:
          const adjustment = weightAdjustments[item.id] || 0;
          return item.weight + adjustment;
      }
  };

  // Helper to get distributed weight for a child
  const getDistributedChildWeight = (child: Assessment, group: GroupedAssessment) => {
      if (droppedMap[child.id]) return 0;
      
      // 1. Child's own base weight
      let weight = child.weight;
      
      // 2. Child's own direct adjustment (if any)
      weight += (weightAdjustments[child.id] || 0);
      
      // 3. Distributed group adjustment
      const groupAdjustment = weightAdjustments[group.id] || 0;
      if (groupAdjustment !== 0) {
          const activeChildrenCount = group.children.filter(c => !droppedMap[c.id]).length;
          if (activeChildrenCount > 0) {
              weight += groupAdjustment / activeChildrenCount;
          }
      }
      return weight;
  };

  // Calculation Logic
  const calculateCurrentGrade = () => {
    let totalWeight = 0;
    let earnedWeight = 0;

    const displayItems = groupAssessments(assessments);

    displayItems.forEach(item => {
        if (droppedMap[item.id]) return; // Skip dropped items

        if (item.isGroup) {
            const isExpanded = expandedGroups.has(item.id);
            if (isExpanded) {
                // Sum active children with distributed weights
                item.children.forEach(child => {
                    const effWeight = getDistributedChildWeight(child, item);
                    if (effWeight > 0 && child.grade !== undefined && child.grade !== null && !isNaN(child.grade)) {
                        totalWeight += effWeight;
                        earnedWeight += (child.grade / 100) * effWeight;
                    }
                });
            } else {
                // Use group grade with total effective group weight
                const effGroupWeight = getEffectiveWeight(item);
                const gVal = groupGrades[item.id];
                const gNum = parseFloat(gVal || '');
                if (gVal && !isNaN(gNum)) {
                    totalWeight += effGroupWeight;
                    earnedWeight += (gNum / 100) * effGroupWeight;
                }
            }
        } else {
            // Single item
            const effWeight = getEffectiveWeight(item);
            if (item.grade !== undefined && item.grade !== null && !isNaN(item.grade)) {
                totalWeight += effWeight;
                earnedWeight += (item.grade / 100) * effWeight;
            }
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

    const displayItems = groupAssessments(assessments);

    displayItems.forEach(item => {
        if (droppedMap[item.id]) return;

        if (item.isGroup) {
            const isExpanded = expandedGroups.has(item.id);
            
            if (isExpanded) {
                item.children.forEach(child => {
                    const effWeight = getDistributedChildWeight(child, item);
                    if (effWeight <= 0) return;

                    if (child.grade !== undefined && child.grade !== null && !isNaN(child.grade)) {
                        completedWeight += effWeight;
                        earnedWeight += (child.grade / 100) * effWeight;
                    } else {
                        remainingWeight += effWeight;
                    }
                });
            } else {
                const effGroupWeight = getEffectiveWeight(item);
                const gVal = groupGrades[item.id];
                const gNum = parseFloat(gVal || '');
                if (gVal && !isNaN(gNum)) {
                    completedWeight += effGroupWeight;
                    earnedWeight += (gNum / 100) * effGroupWeight;
                } else {
                    remainingWeight += effGroupWeight;
                }
            }
        } else {
            const effWeight = getEffectiveWeight(item);
            if (item.grade !== undefined && item.grade !== null && !isNaN(item.grade)) {
                completedWeight += effWeight;
                earnedWeight += (item.grade / 100) * effWeight;
            } else {
                remainingWeight += effWeight;
            }
        }
    });

    const targetPercent = Number(targetGrade);
    const totalWeight = completedWeight + remainingWeight;
    
    if (remainingWeight === 0) return null; 

    const targetPoints = (targetPercent / 100) * totalWeight;
    const neededPoints = targetPoints - earnedWeight;
    const neededPercent = (neededPoints / remainingWeight) * 100;

    return Math.max(0, neededPercent);
  };

  const calculateTotalProgress = () => {
      let sum = 0;
      const displayItems = groupAssessments(assessments);
      displayItems.forEach(item => {
          if (droppedMap[item.id]) return;
          
          if (item.isGroup) {
              if (expandedGroups.has(item.id)) {
                  item.children.forEach(c => {
                      const effWeight = getDistributedChildWeight(c, item);
                      if (effWeight > 0 && c.grade !== undefined && !isNaN(c.grade)) sum += effWeight;
                  });
              } else {
                  const effGroupWeight = getEffectiveWeight(item);
                  if (groupGrades[item.id]) sum += effGroupWeight;
              }
          } else {
              const effWeight = getEffectiveWeight(item);
              if (item.grade !== undefined && !isNaN(item.grade)) sum += effWeight;
          }
      });
      return sum;
  };

  const handleCalculate = () => {
      const current = calculateCurrentGrade();
      const required = calculateRequiredForTarget();
      const progress = calculateTotalProgress();

      setDisplayStats({
          currentGrade: current,
          requiredGrade: required,
          totalProgress: progress
      });
  };

  const toggleGroup = (groupId: string) => {
      const newSet = new Set(expandedGroups);
      if (newSet.has(groupId)) {
          newSet.delete(groupId);
      } else {
          newSet.add(groupId);
      }
      setExpandedGroups(newSet);
  };

  const handleGroupGradeChange = (groupId: string, val: string) => {
      const num = parseFloat(val);
      const isInvalid = val !== '' && (isNaN(num) || num < 0 || num > 100);
      
      setGroupGrades(prev => ({...prev, [groupId]: val}));
      
      setInvalidGrades(prev => {
        const next = { ...prev };
        if (isInvalid) next[`group-${groupId}`] = true;
        else delete next[`group-${groupId}`];
        return next;
      });
  };

  // When a group header weight is changed, evenly redistribute that total weight
  // across all active (non-dropped, non-removed) children in the group.
  const handleGroupWeightChange = (groupId: string, val: string) => {
    // If the user cleared the input, zero out all active children weights
    // and clear their displayed weight input values.
    if (val.trim() === "") {
      setAssessments(prev => {
        const displayItems = groupAssessments(prev);
        const group = displayItems.find(
          (item): item is GroupedAssessment => item.isGroup && item.id === groupId
        );
        if (!group) return prev;

        const activeChildrenIds = group.children
          .filter(child => !removedItems.has(child.id) && !droppedMap[child.id])
          .map(child => child.id);

        if (activeChildrenIds.length === 0) return prev;

        return prev.map(a =>
          activeChildrenIds.includes(a.id)
            ? {
                ...a,
                weight: 0,
                weightInputValue: "",
              }
            : a
        );
      });
      return;
    }

    const num = parseFloat(val);
    if (isNaN(num) || num < 0) return;

    setAssessments(prev => {
      const displayItems = groupAssessments(prev);
      const group = displayItems.find(
        (item): item is GroupedAssessment => item.isGroup && item.id === groupId
      );
      if (!group) return prev;

      // Only adjust children that are still active in the UI
      const activeChildrenIds = group.children
        .filter(child => !removedItems.has(child.id) && !droppedMap[child.id])
        .map(child => child.id);

      if (activeChildrenIds.length === 0) return prev;

      const perChild = num / activeChildrenIds.length;

      return prev.map(a =>
        activeChildrenIds.includes(a.id)
          ? {
              ...a,
              weight: perChild,
              weightInputValue: Number.isInteger(perChild)
                ? perChild.toString()
                : Number(perChild).toFixed(5).replace(/\.?0+$/, ''),
            }
          : a
      );
    });
  };

  const handleWeightChange = (id: string, val: string) => {
    const num = parseFloat(val);
    const isValid = !isNaN(num) && num >= 0;

    setAssessments(prev =>
      prev.map(a =>
        a.id === id
          ? {
              ...a,
              weightInputValue: val,
              weight: isValid ? num : 0,
            }
          : a
      )
    );
  };

  const handleGradeChange = (id: string, val: string) => {
    const num = parseFloat(val);
    const withinRange = !isNaN(num) && num >= 0 && num <= 100;
    const isInvalid = val !== '' && !withinRange;

    setAssessments(prev =>
      prev.map(a =>
        a.id === id
          ? {
              ...a,
              inputValue: val,
              grade: val === ''
                ? undefined
                : withinRange
                  ? num
                  : undefined,
            }
          : a
      )
    );

    setInvalidGrades(prev => {
      const next = { ...prev };
      if (isInvalid) {
        next[id] = true;
      } else {
        delete next[id];
      }
      return next;
    });
  };

  // Rename Handlers
  const handleStartRename = (e: React.MouseEvent, id: string, isGroup: boolean, groupId?: string) => {
    e.stopPropagation();
    if (dropMode !== 'none') return;
    
    const currentItems = groupAssessments(assessments);
    let name = '';
    
    if (isGroup) {
      const group = currentItems.find(item => item.isGroup && item.id === id);
      if (group) name = group.name.replace(/^[""'"]+|[""'"]+$/g, '').trim();
    } else {
      const assessment = assessments.find(a => a.id === id);
      if (assessment) name = assessment.name;
    }
    
    setEditingNameId({ id, isGroup, groupId });
    setEditingNameValue(name);
    
    // Focus the input after state update
    setTimeout(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }, 0);
  };

  const handleSaveRename = async () => {
    if (!editingNameId || !course) return;
    
    const newName = editingNameValue.trim();
    if (!newName) {
      // Cancel if empty
      setEditingNameId(null);
      setEditingNameValue('');
      return;
    }

    if (editingNameId.isGroup) {
      // For groups, we need to update all children with the same base name
      // Find the group and update all children
      const group = groupAssessments(assessments).find(item => item.isGroup && item.id === editingNameId.id);
      if (group && group.isGroup) {
        // Extract the base name pattern and update all children
        const childrenToUpdate = group.children;
        const updatePromises = childrenToUpdate.map(async (child) => {
          // Try to preserve the number suffix if it exists (match number at the end, possibly with # or space)
          const match = child.name.match(/(.*?)(?:\s*#?\s*)(\d+)$/);
          if (match) {
            const num = match[2];
            // Remove quotes and get base name
            let baseName = newName.replace(/^[""'"]+|[""'"]+$/g, '').trim();
            // Remove plural 's' if present
            if (baseName.toLowerCase().endsWith('s') && !baseName.toLowerCase().endsWith('ss')) {
              baseName = baseName.slice(0, -1);
            }
            const updatedName = `${baseName} ${num}`;
            await supabase
              .from('assessments')
              .update({ name: updatedName })
              .eq('id', child.id);
            
            // Update local state
            setAssessments(prev => prev.map(a => 
              a.id === child.id ? { ...a, name: updatedName } : a
            ));
          } else {
            // Try to match just a number at the end (fallback)
            const simpleMatch = child.name.match(/(.*?)(\d+)$/);
            if (simpleMatch) {
              const num = simpleMatch[2];
              let baseName = newName.replace(/^[""'"]+|[""'"]+$/g, '').trim();
              if (baseName.toLowerCase().endsWith('s') && !baseName.toLowerCase().endsWith('ss')) {
                baseName = baseName.slice(0, -1);
              }
              const updatedName = `${baseName} ${num}`;
              await supabase
                .from('assessments')
                .update({ name: updatedName })
                .eq('id', child.id);
              
              setAssessments(prev => prev.map(a => 
                a.id === child.id ? { ...a, name: updatedName } : a
              ));
            } else {
              // No number found, just use the new name
              await supabase
                .from('assessments')
                .update({ name: newName })
                .eq('id', child.id);
              
              setAssessments(prev => prev.map(a => 
                a.id === child.id ? { ...a, name: newName } : a
              ));
            }
          }
        });
        await Promise.all(updatePromises);
      }
    } else {
      // For individual assessments, update directly
      const { error } = await supabase
        .from('assessments')
        .update({ name: newName })
        .eq('id', editingNameId.id);
      
      if (!error) {
        setAssessments(prev => prev.map(a => 
          a.id === editingNameId.id ? { ...a, name: newName } : a
        ));
      }
    }
    
    setEditingNameId(null);
    setEditingNameValue('');
  };

  const handleCancelRename = () => {
    setEditingNameId(null);
    setEditingNameValue('');
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelRename();
    }
  };

  // Add/Remove Assessment Handlers
  const handleAddAssessment = () => {
    if (!course) return;
    
    // Generate a temporary ID for local-only assessments
    const newId = `new-${Date.now()}`;
    const maxOrderIndex = assessments.length > 0 
      ? Math.max(...assessments.map(a => a.order_index || 0))
      : 0;
    
    const newAssessment: Assessment = {
      id: newId,
      name: 'New Assessment',
      weight: 0,
      weightInputValue: '0',
      grade: undefined,
      inputValue: '',
      order_index: maxOrderIndex + 100
    };

    // Add to local state only (not saved to database)
    setAssessments([...assessments, newAssessment]);
  };

  const handleRemoveAssessment = (itemId: string, isGroup: boolean) => {
    const newRemoved = new Set(removedItems);
    
    if (isGroup) {
      const displayItems = groupAssessments(assessments);
      const group = displayItems.find(g => g.isGroup && g.id === itemId);
      if (group && group.isGroup) {
        newRemoved.add(itemId);
        group.children.forEach(child => {
          newRemoved.add(child.id);
        });
      }
    } else {
      newRemoved.add(itemId);
    }
    
    setRemovedItems(newRemoved);
    setRemoveMode(false);
  };

  const handleRemoveModeClick = (item: DisplayItem) => {
    if (!removeMode) return;
    handleRemoveAssessment(item.id, !!item.isGroup);
  };

  // Drag and Drop Handlers
  const handleDragStart = (e: React.DragEvent, item: DisplayItem, groupId?: string) => {
    if (dropMode !== 'none' || removeMode) return;
    const isGroup = !!item.isGroup;
    setDraggedItem({ id: item.id, isGroup, groupId });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', '');
  };

  const handleDragOver = (e: React.DragEvent, item: DisplayItem, groupId?: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropMode !== 'none' || removeMode) return;
    if (!draggedItem) return;
    if (draggedItem.id === item.id && draggedItem.groupId === groupId) return;
    if (draggedItem.groupId) {
      if (groupId !== draggedItem.groupId) return;
    }
    if (!draggedItem.isGroup && !draggedItem.groupId && item.isGroup) {
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    const position = e.clientY < midpoint ? 'before' : 'after';
    setDragOverItem({ id: item.id, isGroup: !!item.isGroup, groupId, position });
  };

  const handleDragLeave = () => {
    setDragOverItem(null);
  };

  const handleDrop = (e: React.DragEvent, targetItem: DisplayItem, targetGroupId?: string, position?: 'before' | 'after') => {
    e.preventDefault();
    // Capture position before clearing dragOverItem
    const dropPosition = position || dragOverItem?.position || 'after';
    setDragOverItem(null);
    if (dropMode !== 'none' || removeMode) return;
    if (!draggedItem) return;
    if (draggedItem.id === targetItem.id && draggedItem.groupId === targetGroupId) {
      setDraggedItem(null);
      return;
    }
    if (draggedItem.groupId) {
      if (targetGroupId !== draggedItem.groupId) {
        setDraggedItem(null);
        return;
      }
    }
    if (!draggedItem.isGroup && !draggedItem.groupId && targetItem.isGroup) {
      setDraggedItem(null);
      return;
    }
    
    const currentItems = groupAssessments(assessments);
    let itemsToReorder = [...currentItems];
    let sourceIndex = -1;
    let targetIndex = -1;
    
    if (draggedItem.groupId) {
      const groupIndex = itemsToReorder.findIndex(g => g.isGroup && g.id === draggedItem.groupId);
      if (groupIndex === -1) {
        setDraggedItem(null);
        return;
      }
      const group = itemsToReorder[groupIndex];
      if (!group.isGroup) {
        setDraggedItem(null);
        return;
      }
      sourceIndex = group.children.findIndex(c => c.id === draggedItem.id);
      targetIndex = group.children.findIndex(c => c.id === targetItem.id);
      if (sourceIndex === -1 || targetIndex === -1) {
        setDraggedItem(null);
        return;
      }
      const newChildren = [...group.children];
      const [removed] = newChildren.splice(sourceIndex, 1);
      const insertIndex = dropPosition === 'before' ? targetIndex : targetIndex + 1;
      newChildren.splice(insertIndex > sourceIndex ? insertIndex - 1 : insertIndex, 0, removed);
      itemsToReorder[groupIndex] = {
        ...group,
        children: newChildren
      };
    } else {
      // Top-level reordering (groups or single items)
      sourceIndex = itemsToReorder.findIndex(i => {
        if (draggedItem.isGroup) {
          return i.isGroup && i.id === draggedItem.id;
        } else {
          return !i.isGroup && i.id === draggedItem.id;
        }
      });
      targetIndex = itemsToReorder.findIndex(i => {
        if (targetItem.isGroup) {
          return i.isGroup && i.id === targetItem.id;
        } else {
          return !i.isGroup && i.id === targetItem.id;
        }
      });
      
      if (sourceIndex === -1 || targetIndex === -1) {
        console.log('Drag drop failed - indices not found', { sourceIndex, targetIndex, draggedItem, targetItem });
        setDraggedItem(null);
        return;
      }
      
      // Handle the case where source and target are the same (shouldn't happen, but safety check)
      if (sourceIndex === targetIndex) {
        setDraggedItem(null);
        return;
      }
      
      const [removed] = itemsToReorder.splice(sourceIndex, 1);
      const insertIndex = dropPosition === 'before' ? targetIndex : targetIndex + 1;
      
      // Adjust insert index: if we removed an item before the target position, we need to shift the insert index
      let adjustedInsertIndex = insertIndex;
      if (sourceIndex < insertIndex) {
        adjustedInsertIndex = insertIndex - 1;
      }
      
      // Ensure we don't go out of bounds (shouldn't happen, but safety check)
      adjustedInsertIndex = Math.max(0, Math.min(adjustedInsertIndex, itemsToReorder.length));
      
      itemsToReorder.splice(adjustedInsertIndex, 0, removed);
    }
    
    // Build a map of all assessments for quick lookup
    const assessmentMap = new Map(assessments.map(a => [a.id, a]));
    
    // Rebuild assessments array in the new order
    const reorderedAssessments: Assessment[] = [];
    const processedIds = new Set<string>();
    
    itemsToReorder.forEach((item) => {
      if (item.isGroup) {
        item.children.forEach((child) => {
          const assessment = assessmentMap.get(child.id);
          if (assessment && !processedIds.has(child.id)) {
            reorderedAssessments.push(assessment);
            processedIds.add(child.id);
          }
        });
      } else {
        const assessment = assessmentMap.get(item.id);
        if (assessment && !processedIds.has(item.id)) {
          reorderedAssessments.push(assessment);
          processedIds.add(item.id);
        }
      }
    });
    
    // Add any assessments that weren't in the display items (shouldn't happen, but safety check)
    assessments.forEach(assessment => {
      if (!processedIds.has(assessment.id)) {
        reorderedAssessments.push(assessment);
      }
    });
    
    // Update order_index locally for each assessment to reflect the new order
    // This ensures groupAssessments will sort them correctly
    const reorderedWithNewIndices = reorderedAssessments.map((assessment, index) => ({
      ...assessment,
      order_index: index * 100
    }));
    
    // Update local state only (no database updates - drag and drop is local-only)
    setAssessments(reorderedWithNewIndices);
    setDraggedItem(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverItem(null);
  };

  if (loading) return <div className="p-10 text-center">Loading course data...</div>;
  if (!course) return <div className="p-10 text-center">Course not found. <a href="/" className="text-primary underline">Go Home</a></div>;

  return (
    <div className="max-w-4xl mx-auto pb-20 pt-12 sm:pt-16">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">{course.code}</h1>
        {availableSections.length > 1 ? (
            <div className="mt-2 relative group inline-block max-w-full">
                <ChevronDown className="absolute left-0 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors pointer-events-none" />
                  <select 
                    className="text-xl text-muted-foreground bg-transparent border-b border-dashed border-gray-400 outline-none pb-1 pl-8 pr-8 appearance-none cursor-pointer hover:text-foreground transition-colors w-full truncate"
                      value={course.id}
                      onChange={(e) => handleSectionChange(e.target.value)}
                  >
                      {availableSections.map(section => (
                          <option key={section.id} value={section.id}>
                              {section.name}
                          </option>
                      ))}
                  </select>
            </div>
        ) : (
            <h2 className="text-xl text-muted-foreground">{course.name}</h2>
        )}
        <div className="block bg-secondary px-3 py-1 rounded-full text-sm font-medium mt-2 w-fit">
          {course.term}
        </div>
      </header>

      <div className="grid md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
            <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
              <div className="bg-muted/30 px-6 py-4 border-b flex justify-between items-center gap-4">
                <div className="flex items-center gap-4">
                  <h3 className="font-semibold flex items-center">
                    <Calculator className="w-4 h-4 mr-2" /> Assessments
                  </h3>
                  {dropMode === 'selectTarget' && (
                     <button 
                         onClick={handleDistributeEvenly}
                         disabled={Array.from(removedItems).some(id => !id.startsWith('new-'))}
                         className={`text-xs px-3 py-1.5 rounded-full transition-colors font-medium ${
                           Array.from(removedItems).some(id => !id.startsWith('new-'))
                             ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                             : 'bg-green-500 text-white hover:bg-green-600'
                         }`}
                     >
                         Divide weight evenly
                     </button>
                  )}
                  {removeMode && (
                    <span className="text-sm text-orange-600 font-medium">Click an assessment to remove it</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleAddAssessment}
                    disabled={dropMode !== 'none' || removeMode}
                    className="p-1.5 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Add Assessment"
                  >
                    <Plus className="w-5 h-5 text-gray-700" />
                  </button>
                  <button
                    onClick={() => setRemoveMode(!removeMode)}
                    disabled={dropMode !== 'none'}
                    className={`p-1.5 rounded-md hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                      removeMode ? 'bg-red-100' : ''
                    }`}
                    title="Remove Assessment"
                  >
                    <Minus className="w-5 h-5 text-gray-700" />
                  </button>
                </div>
              </div>

              <div className="divide-y relative">
                {groupAssessments(assessments)
                  .filter(item => !removedItems.has(item.id))
                  .length === 0 && (
                  <div className="px-6 py-12 text-center text-muted-foreground">
                    <p>No assessments yet. Click the + button to add one.</p>
                  </div>
                )}
                
                {groupAssessments(assessments)
                  .filter(item => !removedItems.has(item.id))
                  .map((item, itemIndex) => {
                  const isDropped = !!droppedMap[item.id];
                  const isSource = dropSourceId === item.id;
                  const isTargetCandidate = dropMode === 'selectTarget' && !isDropped && !isSource;
                  const isSourceCandidate = dropMode === 'selectSource' && !isDropped;
                  const adjustment = weightAdjustments[item.id] || 0;
                  
                  const handleClick = () => handleItemClick(item);
                  
                  const rowClasses = `pl-3 pr-6 py-4 flex items-center gap-2 transition-all relative ${
                      isDropped ? 'opacity-50 bg-gray-50' :
                      removeMode ? 'hover:bg-red-50 cursor-pointer hover:border-l-4 hover:border-red-500' :
                      isSource ? 'bg-red-50 border-l-4 border-red-500' :
                      isTargetCandidate ? 'hover:bg-green-50 cursor-pointer hover:border-l-4 hover:border-green-500' :
                      isSourceCandidate ? 'hover:bg-red-50 cursor-pointer hover:border-l-4 hover:border-red-500' :
                      'hover:bg-accent/5'
                  }`;

                  if (item.isGroup) {
                      const isExpanded = expandedGroups.has(item.id);
                      const isInvalid = !!invalidGrades[`group-${item.id}`];
                      
                      // Calculate adjustments
                      const adjustment = weightAdjustments[item.id] || 0;
                      
                      // Identify internal adjustments (dropped children -> group)
                      let internalAdjustment = 0;
                      item.children.forEach(child => {
                          if (droppedMap[child.id] === item.id) {
                              internalAdjustment += child.weight + (weightAdjustments[child.id] || 0);
                          }
                      });
                      
                      const displayAdjustment = adjustment - internalAdjustment;

                      // Calculate dynamic displayed weight for the group
                      // Sum of effective weights of non-dropped children + Group-level adjustments
                      // Note: If internal adjustment, we want to show the original total (or whatever the effective total is)
                      // If I drop a child (2%) -> Group. Group gains 2%.
                      // Active Children Sum = 18%. Group Adj = 2%. Total = 20%.
                      // This is correct.
                      const childrenSum = item.children.reduce((sum, child) => {
                          if (droppedMap[child.id]) return sum;
                          // We use BASE weight here because getEffectiveWeight adds group distribution which is circular?
                          // No, getEffectiveWeight(child) returns childBase + childDirectAdj + DistributedGroupAdj.
                          // If we sum them up, we get Total Group Weight.
                          // BUT getDistributedChildWeight adds (GroupAdj / Count).
                          // Summing (GroupAdj / Count) * Count = GroupAdj.
                          // So Sum(DistributedChildWeights) = Sum(Base) + GroupAdj.
                          // This is exactly what we want.
                          return sum + getDistributedChildWeight(child, item);
                      }, 0);
                      
                      const displayedTotalWeight = childrenSum; 

                      const isDragging = draggedItem?.id === item.id && !draggedItem.groupId;
                      const isDragOver = dragOverItem?.id === item.id && !dragOverItem.groupId;
                      
                      return (
                          <div key={item.id} className="bg-white">
                              {/* Insertion line indicator before */}
                              {isDragOver && dragOverItem?.position === 'before' && (
                                  <div className="h-0.5 bg-blue-500 ml-3 mr-6" />
                              )}
                              <div 
                                  className={`${rowClasses} ${isDragging ? 'opacity-50' : ''}`}
                                  draggable={dropMode === 'none' && !removeMode}
                                  onDragStart={(e) => handleDragStart(e, item)}
                                  onDragOver={(e) => handleDragOver(e, item)}
                                  onDragLeave={handleDragLeave}
                                  onDrop={(e) => handleDrop(e, item)}
                                  onDragEnd={handleDragEnd}
                                  onClick={(e) => {
                                      if (removeMode) {
                                          e.stopPropagation();
                                          handleRemoveModeClick(item);
                                          return;
                                      }
                                      if (dropMode !== 'none') {
                                          e.stopPropagation();
                                          handleClick();
                                      }
                                  }}
                              >
                                  {isTargetCandidate && (
                                      <div className="absolute inset-0 flex items-center justify-center bg-green-50/90 opacity-0 hover:opacity-100 font-bold text-green-700 z-10 transition-opacity">
                                          Transfer weight here
                                      </div>
                                  )}
                                  
                                  {isSource && (
                                      <div className="absolute inset-0 flex items-center justify-center bg-red-50/90 font-bold text-red-700 z-10">
                                          Where should this weight go? Select another item.
                                      </div>
                                  )}
                                  
                                  {removeMode && (
                                      <div className="absolute inset-0 flex items-center justify-center bg-red-50/90 opacity-0 hover:opacity-100 font-bold text-red-700 z-10 transition-opacity">
                                          Click to remove
                                      </div>
                                  )}

                                  <GripVertical 
                                      className="w-4 h-4 text-gray-400 cursor-grab active:cursor-grabbing" 
                                  />
                                  <button 
                                      onClick={(e) => {
                                          e.stopPropagation();
                                          toggleGroup(item.id);
                                      }}
                                      onMouseDown={(e) => e.stopPropagation()}
                                      className="p-1 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50"
                                  >
                                      {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
                                  </button>
                                  
                              <div 
                                  className="flex-1 cursor-pointer"
                                  draggable={false}
                                  onClick={(e) => {
                                      if (dropMode === 'none' && editingNameId?.id !== item.id) toggleGroup(item.id);
                                  }}
                              >
                                  {editingNameId?.id === item.id && editingNameId.isGroup ? (
                                      <input
                                          ref={nameInputRef}
                                          type="text"
                                          value={editingNameValue}
                                          onChange={(e) => setEditingNameValue(e.target.value)}
                                          onBlur={handleSaveRename}
                                          onKeyDown={handleRenameKeyDown}
                                          onClick={(e) => e.stopPropagation()}
                                          onMouseDown={(e) => e.stopPropagation()}
                                          className="font-medium border border-primary rounded px-1 py-0.5 w-full max-w-md focus:outline-none focus:ring-2 focus:ring-primary"
                                      />
                                  ) : (
                                      <div 
                                          className={`font-medium ${isDropped ? 'line-through' : ''}`}
                                          onDoubleClick={(e) => handleStartRename(e, item.id, true)}
                                      >
                                          {item.name.replace(/^[""'"]+|[""'"]+$/g, '').trim()}
                                      {isDropped && <span className="ml-2 text-xs text-red-500 no-underline">(Dropped)</span>}
                                  </div>
                                  )}
                                  <div className="mt-0.5 text-sm text-muted-foreground flex flex-wrap items-center gap-2">
                                      <span>{item.children.filter(c => !droppedMap[c.id] && !removedItems.has(c.id)).length} items</span>
                                      <span>•</span>
                                      <div className="flex items-center gap-1">
                                          <span>Total</span>
                                          <input
                                              type="number"
                                              min="0"
                                              step="any"
                                              className="w-14 border-b border-border bg-transparent text-center text-xs outline-none focus:border-primary"
                                              value={
                                                displayedTotalWeight === 0
                                                  ? ""
                                                  : Math.abs(displayedTotalWeight - Math.round(displayedTotalWeight)) < 0.01
                                                    ? Math.round(displayedTotalWeight)
                                                    : Number(displayedTotalWeight).toFixed(5).replace(/\.?0+$/, '')
                                              }
                                              onChange={(e) => {
                                                e.stopPropagation();
                                                handleGroupWeightChange(item.id, e.target.value);
                                              }}
                                              onClick={(e) => e.stopPropagation()}
                                              onMouseDown={(e) => e.stopPropagation()}
                                              onFocus={(e) => e.stopPropagation()}
                                          />
                                          <span>% weight</span>
                                      </div>
                                  </div>
                              </div>

                                  {!isDropped ? (
                                      <div className="w-[6.25rem]">
                                          <input
                                              type="number"
                                              placeholder="Avg %"
                                              disabled={isExpanded || dropMode !== 'none'} 
                                              className={`w-full rounded-md border pl-3 pr-2 py-2 text-sm text-left outline-none transition focus:ring-2 ${
                                                  isExpanded || dropMode !== 'none'
                                                      ? "bg-gray-100 text-gray-400 cursor-not-allowed border-gray-200" 
                                                      : isInvalid
                                                          ? "border-red-500 focus:ring-red-400 focus:border-red-400"
                                                          : "border-gray-300 focus:border-primary focus:ring-primary/40"
                                              }`}
                                              min="0"
                                              max="100"
                                              value={groupGrades[item.id] || ''}
                                              onChange={(e) => handleGroupGradeChange(item.id, e.target.value)}
                                          />
                                      </div>
                                  ) : (
                                     <button onClick={() => handleUndrop(item.id)} className="p-2 hover:bg-gray-200 rounded-full text-gray-500" title="Undrop">
                                         <RotateCcw className="w-4 h-4" />
                                     </button>
                                  )}
                              </div>
                              {/* Insertion line indicator after */}
                              {isDragOver && dragOverItem?.position === 'after' && (
                                  <div className="h-0.5 bg-blue-500 ml-3 mr-6" />
                              )}
                              {isExpanded && (
                                  <div 
                                      className="bg-gray-50/50 border-t border-gray-100 divide-y divide-gray-100/50"
                                      onDragOver={(e) => {
                                          // Allow drag events to bubble up to parent group for reordering
                                          // Only handle if dragging a child within this group
                                          if (draggedItem?.groupId === item.id) {
                                              return; // Let child handle it
                                          }
                                          // For top-level groups being dragged, allow drop on the group itself
                                          if (draggedItem?.isGroup && !draggedItem.groupId) {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              handleDragOver(e, item);
                                          }
                                      }}
                                      onDrop={(e) => {
                                          // Only handle if dragging a child within this group
                                          if (draggedItem?.groupId === item.id) {
                                              return; // Let child handle it
                                          }
                                          // For top-level groups being dragged, allow drop on the group itself
                                          if (draggedItem?.isGroup && !draggedItem.groupId) {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              handleDrop(e, item);
                                          }
                                      }}
                                  >
                                      {item.children.filter(child => !removedItems.has(child.id)).map((child) => {
                                          const isChildDropped = !!droppedMap[child.id];
                                          const isChildSource = dropSourceId === child.id;
                                          
                                          const isChildTargetCandidate = dropMode === 'selectTarget' && !isChildDropped && !isChildSource && !isDropped;
                                          const isChildSourceCandidate = dropMode === 'selectSource' && !isChildDropped && !isDropped;
                                          
                                          const childAdjustment = weightAdjustments[child.id] || 0;
                                          const isChildInvalid = !!invalidGrades[child.id];
                                          
                                          const childRowClasses = `pl-14 pr-6 py-3 flex items-center gap-2 transition-all relative ${
                                              isChildDropped ? 'opacity-50 bg-gray-100' :
                                              removeMode ? 'hover:bg-red-50 cursor-pointer hover:border-l-4 hover:border-red-500' :
                                              isChildSource ? 'bg-red-50 border-l-4 border-red-500' :
                                              isChildTargetCandidate ? 'hover:bg-green-50 cursor-pointer hover:border-l-4 hover:border-green-500' :
                                              isChildSourceCandidate ? 'hover:bg-red-50 cursor-pointer hover:border-l-4 hover:border-red-500' :
                                              ''
                                          }`;
                                          
                                          // Calculate distributed weight for display
                                          const distributedWeight = getDistributedChildWeight(child, item);
                                          
                                          const isChildDragging = draggedItem?.id === child.id && draggedItem.groupId === item.id;
                                          const isChildDragOver = dragOverItem?.id === child.id && dragOverItem.groupId === item.id;

                                          return (
                                              <div key={`child-wrapper-${child.id}`}>
                                                  {/* Insertion line indicator before */}
                                                  {isChildDragOver && dragOverItem?.position === 'before' && (
                                                      <div className="h-0.5 bg-blue-500 ml-14 mr-6" />
                                                  )}
                                                  <div 
                                                      key={child.id} 
                                                      className={`${childRowClasses} ${isChildDragging ? 'opacity-50' : ''}`}
                                                  draggable={dropMode === 'none' && !removeMode}
                                                  onDragStart={(e) => handleDragStart(e, child, item.id)}
                                                  onDragOver={(e) => handleDragOver(e, child, item.id)}
                                                  onDragLeave={handleDragLeave}
                                                  onDrop={(e) => handleDrop(e, child, item.id)}
                                                  onDragEnd={handleDragEnd}
                                                  onClick={(e) => {
                                                      if (removeMode) {
                                                          e.stopPropagation();
                                                          handleRemoveModeClick(child as any);
                                                          return;
                                                      }
                                                      if (dropMode !== 'none') {
                                                          e.stopPropagation();
                                                          handleItemClick(child as any);
                                                      }
                                                  }}
                                              >
                                                  {isChildTargetCandidate && (
                                                      <div className="absolute inset-0 flex items-center justify-center bg-green-50/90 opacity-0 hover:opacity-100 font-bold text-green-700 z-10 transition-opacity text-xs">
                                                          Transfer here
                                                      </div>
                                                  )}
                                                  
                                                  {isChildSource && (
                                                      <div className="absolute inset-0 flex items-center justify-center bg-red-50/90 font-bold text-red-700 z-10 text-xs">
                                                          Transfer where?
                                                      </div>
                                                  )}
                                                  
                                                  {removeMode && (
                                                      <div className="absolute inset-0 flex items-center justify-center bg-red-50/90 opacity-0 hover:opacity-100 font-bold text-red-700 z-10 transition-opacity text-xs">
                                                          Click to remove
                                                      </div>
                                                  )}

                                                  <GripVertical 
                                                      className="w-4 h-4 text-gray-400 cursor-grab active:cursor-grabbing" 
                                                  />
                                                  <div className="flex-1">
                                                      {editingNameId?.id === child.id && !editingNameId.isGroup && editingNameId.groupId === item.id ? (
                                                          <input
                                                              ref={nameInputRef}
                                                              type="text"
                                                              value={editingNameValue}
                                                              onChange={(e) => setEditingNameValue(e.target.value)}
                                                              onBlur={handleSaveRename}
                                                              onKeyDown={handleRenameKeyDown}
                                                              onClick={(e) => e.stopPropagation()}
                                                              className="text-sm font-medium text-gray-700 border border-primary rounded px-1 py-0.5 w-full max-w-md focus:outline-none focus:ring-2 focus:ring-primary"
                                                          />
                                                      ) : (
                                                          <div 
                                                              className={`text-sm font-medium text-gray-700 ${isChildDropped ? 'line-through' : ''}`}
                                                              onDoubleClick={(e) => handleStartRename(e, child.id, false, item.id)}
                                                          >
                                                          {child.name}
                                                          {isChildDropped && <span className="ml-2 text-xs text-red-500 no-underline">(Dropped)</span>}
                                                      </div>
                                                      )}
                                                      <div className="flex items-center text-xs text-muted-foreground mt-0.5">
                                                          <input
                                                              type="number"
                                                              disabled={isChildDropped || dropMode !== 'none'}
                                                              className="w-12 border-b border-border bg-transparent text-center outline-none focus:border-primary px-0.5 mr-1 disabled:opacity-50"
                                                              value={
                                                                  focusedId === child.id
                                                                      ? (child.weightInputValue ?? (Number.isInteger(child.weight) ? child.weight : Number(child.weight).toFixed(5).replace(/\.?0+$/, '')))
                                                                      : (Number.isInteger(distributedWeight) 
                                                                          ? distributedWeight 
                                                                          : Number(distributedWeight).toFixed(5).replace(/\.?0+$/, '')) 
                                                              }
                                                              onFocus={() => setFocusedId(child.id)}
                                                              onBlur={() => setFocusedId(null)}
                                                              onChange={(e) => handleWeightChange(child.id, e.target.value)}
                                                              min="0"
                                                              step="any"
                                                          />
                                                          <span>%&nbsp;</span>
                                                      </div>
                                                  </div>
                                                  {!isChildDropped ? (
                                                      <div className="w-[6.25rem]">
                                                          <input
                                                              type="number"
                                                              placeholder="Grade %"
                                                              disabled={dropMode !== 'none'}
                                                              className={`w-full rounded-md border pl-3 pr-2 py-2 text-sm text-left outline-none transition focus:ring-2 bg-white ${
                                                                  isChildInvalid
                                                                      ? "border-red-500 focus:ring-red-400 focus:border-red-400"
                                                                      : "border-gray-300 focus:border-primary focus:ring-primary/40"
                                                              }`}
                                                              min="0"
                                                              max="100"
                                                              value={child.inputValue ?? ""}
                                                              onChange={(e) => handleGradeChange(child.id, e.target.value)}
                                                          />
                                                      </div>
                                                  ) : (
                                                     <button onClick={() => handleUndrop(child.id)} className="p-2 hover:bg-gray-200 rounded-full text-gray-500" title="Undrop">
                                                         <RotateCcw className="w-4 h-4" />
                                                     </button>
                                                  )}
                                              </div>
                                              {/* Insertion line indicator after */}
                                              {isChildDragOver && dragOverItem?.position === 'after' && (
                                                  <div className="h-0.5 bg-blue-500 mx-6 ml-14" />
                                              )}
                                          </div>
                                          );
                                      })}
                                      {/* Drop zone after the last child - allows dropping items after the bottom child */}
                                      {draggedItem && draggedItem.groupId === item.id && item.children.filter(c => !removedItems.has(c.id)).length > 0 && (
                                          <div
                                              className="h-1 relative -mt-1"
                                              onDragOver={(e) => {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  if (draggedItem && draggedItem.groupId === item.id) {
                                                      const visibleChildren = item.children.filter(c => !removedItems.has(c.id));
                                                      const lastChild = visibleChildren[visibleChildren.length - 1];
                                                      if (lastChild && draggedItem.id !== lastChild.id) {
                                                          // Force position to 'after' for the drop zone
                                                          setDragOverItem({ id: lastChild.id, isGroup: false, groupId: item.id, position: 'after' });
                                                      }
                                                  }
                                              }}
                                              onDrop={(e) => {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  if (draggedItem && draggedItem.groupId === item.id) {
                                                      const visibleChildren = item.children.filter(c => !removedItems.has(c.id));
                                                      const lastChild = visibleChildren[visibleChildren.length - 1];
                                                      if (lastChild && draggedItem.id !== lastChild.id) {
                                                          // Pass position directly to handleDrop
                                                          handleDrop(e, lastChild, item.id, 'after');
                                                      }
                                                  }
                                              }}
                                              onDragLeave={(e) => {
                                                  // Only clear if we're actually leaving the drop zone
                                                  const relatedTarget = e.relatedTarget as HTMLElement;
                                                  if (!e.currentTarget.contains(relatedTarget)) {
                                                      // Don't clear if dragOverItem is set for a different position
                                                      if (dragOverItem?.groupId === item.id && dragOverItem?.position === 'after') {
                                                          const visibleChildren = item.children.filter(c => !removedItems.has(c.id));
                                                          const lastChild = visibleChildren[visibleChildren.length - 1];
                                                          if (lastChild && dragOverItem.id === lastChild.id) {
                                                              return; // Keep the drag over state
                                                          }
                                                      }
                                                      setDragOverItem(null);
                                                  }
                                              }}
                                          >
                                              {dragOverItem?.groupId === item.id && dragOverItem?.position === 'after' && (() => {
                                                  const visibleChildren = item.children.filter(c => !removedItems.has(c.id));
                                                  const lastChild = visibleChildren[visibleChildren.length - 1];
                                                  return lastChild && dragOverItem.id === lastChild.id;
                                              })() && (
                                                  <div className="h-0.5 bg-blue-500 mx-6 ml-14" />
                                              )}
                                          </div>
                                      )}
                                  </div>
                              )}
                          </div>
                      );
                  } else {
                      const assessment = item as Assessment;
                      const isInvalid = !!invalidGrades[assessment.id];
                      const effectiveWeight = getEffectiveWeight(assessment);
                      
                      const isDragging = draggedItem?.id === assessment.id && !draggedItem.groupId;
                      const isDragOver = dragOverItem?.id === assessment.id && !dragOverItem.groupId;
                      
                      return (
                        <div key={`single-wrapper-${assessment.id}`}>
                          {/* Insertion line indicator before */}
                          {isDragOver && dragOverItem?.position === 'before' && (
                              <div className="h-0.5 bg-blue-500 ml-3 mr-6" />
                          )}
                          <div
                            key={assessment.id}
                            className={`${rowClasses} ${isDragging ? 'opacity-50' : ''}`}
                            draggable={dropMode === 'none' && !removeMode}
                            onDragStart={(e) => handleDragStart(e, assessment)}
                            onDragOver={(e) => handleDragOver(e, assessment)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, assessment)}
                            onDragEnd={handleDragEnd}
                            onClick={() => {
                              if (removeMode) {
                                handleRemoveModeClick(item);
                                return;
                              }
                              handleItemClick(item);
                            }}
                          >
                          {isTargetCandidate && (
                              <div className="absolute inset-0 flex items-center justify-center bg-green-50/90 opacity-0 hover:opacity-100 font-bold text-green-700 z-10 transition-opacity rounded-lg">
                                  Transfer weight here
                              </div>
                          )}
                          
                          {isSource && (
                              <div className="absolute inset-0 flex items-center justify-center bg-red-50/90 font-bold text-red-700 z-10 rounded-lg">
                                  Where should this weight go? Select another item.
                              </div>
                          )}
                          
                          {removeMode && (
                              <div className="absolute inset-0 flex items-center justify-center bg-red-50/90 opacity-0 hover:opacity-100 font-bold text-red-700 z-10 transition-opacity rounded-lg">
                                  Click to remove
                              </div>
                          )}

                          <GripVertical 
                              className="w-4 h-4 text-gray-400 cursor-grab active:cursor-grabbing" 
                          />
                          <div className="flex-1 ml-6">
                            {editingNameId?.id === assessment.id && !editingNameId.isGroup && !editingNameId.groupId ? (
                                <input
                                    ref={nameInputRef}
                                    type="text"
                                    value={editingNameValue}
                                    onChange={(e) => setEditingNameValue(e.target.value)}
                                    onBlur={handleSaveRename}
                                    onKeyDown={handleRenameKeyDown}
                                    onClick={(e) => e.stopPropagation()}
                                    className="font-medium border border-primary rounded px-1 py-0.5 w-full max-w-md focus:outline-none focus:ring-2 focus:ring-primary"
                                />
                            ) : (
                                <div 
                                    className={`font-medium ${isDropped ? 'line-through' : ''}`}
                                    onDoubleClick={(e) => handleStartRename(e, assessment.id, false)}
                                >
                                    {assessment.name.replace(/^[""'"]+|[""'"]+$/g, '').trim()}
                                {isDropped && <span className="ml-2 text-xs text-red-500 no-underline">(Dropped)</span>}
                            </div>
                            )}
                            <div className="flex items-center text-sm text-muted-foreground mt-1">
                              <input
                                type="number"
                                disabled={isDropped || dropMode !== 'none'}
                                className="w-16 border-b border-border bg-transparent text-center outline-none focus:border-primary px-1 mr-1 disabled:opacity-50"
                                value={
                                    focusedId === assessment.id
                                        ? (assessment.weightInputValue ?? (Number.isInteger(assessment.weight) ? assessment.weight : Number(assessment.weight).toFixed(5).replace(/\.?0+$/, '')))
                                        : (Number.isInteger(effectiveWeight) 
                                            ? effectiveWeight 
                                            : Number(effectiveWeight).toFixed(5).replace(/\.?0+$/, '')) 
                                }
                                onFocus={() => setFocusedId(assessment.id)}
                                onBlur={() => setFocusedId(null)}
                                onChange={(e) => handleWeightChange(assessment.id, e.target.value)}
                                min="0"
                                step="any"
                              />
                              <span>%&nbsp;weight</span>
                            </div>
                          </div>
                          
                          {!isDropped ? (
                              <div className="w-[6.25rem]">
                                <input
                                  type="number"
                                  placeholder="Grade %"
                                  disabled={dropMode !== 'none'}
                                  className={`w-full rounded-md border pl-3 pr-2 py-2 text-sm text-left outline-none transition focus:ring-2 ${
                                    isInvalid
                                      ? "border-red-500 focus:ring-red-400 focus:border-red-400"
                                      : "border-gray-300 focus:border-primary focus:ring-primary/40"
                                  }`}
                                  min="0"
                                  max="100"
                                  value={assessment.inputValue ?? ""}
                                  onChange={(e) => handleGradeChange(assessment.id, e.target.value)}
                                />
                                {isInvalid && (
                                  <p className="mt-1 text-xs text-red-600">Enter a value between 0 and 100.</p>
                                )}
                              </div>
                          ) : (
                             <button onClick={() => handleUndrop(assessment.id)} className="p-2 hover:bg-gray-200 rounded-full text-gray-500" title="Undrop">
                                 <RotateCcw className="w-4 h-4" />
                             </button>
                          )}
                        </div>
                        {/* Insertion line indicator after */}
                        {isDragOver && dragOverItem?.position === 'after' && (
                            <div className="h-0.5 bg-blue-500 ml-3 mr-6" />
                        )}
                      </div>
                      );
                  }
                })}
                {/* Drop zone after the last top-level item - allows dropping groups/items at the bottom */}
                {draggedItem && !draggedItem.groupId && (
                  <div
                        className="h-1 relative -mt-1"
                    onDragOver={(e) => {
                      e.preventDefault();
                            e.stopPropagation();
                            if (draggedItem && !draggedItem.groupId) {
                                const visibleItems = groupAssessments(assessments).filter(item => !removedItems.has(item.id));
                                const lastItem = visibleItems[visibleItems.length - 1];
                                if (lastItem && draggedItem.id !== lastItem.id) {
                                    // Force position to 'after' for the drop zone
                                    setDragOverItem({ 
                                        id: lastItem.id, 
                                        isGroup: !!lastItem.isGroup, 
                                        groupId: undefined, 
                                        position: 'after' 
                                    });
                                }
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                            e.stopPropagation();
                            if (draggedItem && !draggedItem.groupId) {
                                const visibleItems = groupAssessments(assessments).filter(item => !removedItems.has(item.id));
                                const lastItem = visibleItems[visibleItems.length - 1];
                                if (lastItem && draggedItem.id !== lastItem.id) {
                                    // Pass position directly to handleDrop
                                    handleDrop(e, lastItem, undefined, 'after');
                        }
                            }
                        }}
                        onDragLeave={(e) => {
                            // Only clear if we're actually leaving the drop zone
                            const relatedTarget = e.relatedTarget as HTMLElement;
                            if (!e.currentTarget.contains(relatedTarget)) {
                                // Don't clear if dragOverItem is set for a different position
                                if (dragOverItem && !dragOverItem.groupId && dragOverItem.position === 'after') {
                                    const visibleItems = groupAssessments(assessments).filter(item => !removedItems.has(item.id));
                                    const lastItem = visibleItems[visibleItems.length - 1];
                                    if (lastItem && dragOverItem.id === lastItem.id) {
                                        return; // Keep the drag over state
                                    }
                                }
                      setDragOverItem(null);
                            }
                    }}
                  >
                        {dragOverItem && !dragOverItem.groupId && dragOverItem.position === 'after' && (() => {
                            const visibleItems = groupAssessments(assessments).filter(item => !removedItems.has(item.id));
                            const lastItem = visibleItems[visibleItems.length - 1];
                            return lastItem && dragOverItem.id === lastItem.id;
                        })() && (
                      <div className="h-0.5 bg-blue-500 ml-3 mr-6" />
                    )}
                  </div>
                )}
              </div>

              <div className="bg-gray-50 px-6 py-4 border-t flex justify-between items-center">
                  <div className="text-sm font-medium">
                      {dropMode === 'selectSource' && <span className="text-red-600">Select an assessment to drop...</span>}
                      {dropMode === 'selectTarget' && <span className="text-green-600">Select target for weight transfer...</span>}
                  </div>
                  
                  <div className="flex gap-3">
                      <button
                        onClick={handleDropButtonClick}
                        className={`font-medium py-1.5 px-4 rounded-lg shadow-sm transition-all text-sm border ${
                            dropMode !== 'none' 
                                ? 'bg-gray-200 text-gray-700 hover:bg-gray-300 border-gray-300' 
                                : 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                        }`}
                      >
                          {dropMode !== 'none' ? 'Cancel Drop' : 'Drop Item'}
                      </button>
                      
                      <button
                        onClick={handleCalculate}
                        disabled={dropMode !== 'none'}
                        className="bg-green-600/80 hover:bg-green-600 text-white font-medium py-1.5 px-4 rounded-lg shadow-sm transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                          Calculate
                      </button>
                  </div>
              </div>
            </div>
        </div>

        <div className="space-y-6">
          <div className="bg-card border rounded-xl shadow-sm p-6">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">Current Grade</h3>
            <div className="flex items-baseline gap-2">
              <span className={`text-5xl font-bold ${displayStats.currentGrade >= 80 ? 'text-green-600' : displayStats.currentGrade >= 60 ? 'text-primary' : 'text-orange-500'}`}>
                {displayStats.currentGrade.toFixed(1)}%
              </span>
            </div>
            <div className="mt-4 h-2 bg-secondary rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary transition-all duration-500" 
                style={{ width: `${Math.min(displayStats.totalProgress, 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Based on {displayStats.totalProgress.toFixed(0)}% completed work
            </p>
          </div>

          <div className="bg-card border rounded-xl shadow-sm p-6">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center">
              <GraduationCap className="w-4 h-4 mr-2" /> Target Calculator
            </h3>
            
            <div className="flex flex-wrap items-center gap-3 mb-4 text-sm">
              <span className="text-sm">I want a final grade of</span>
              <input 
                type="number" 
                className="w-24 px-3 py-1.5 border rounded text-center font-semibold"
                placeholder="85"
                value={targetGrade}
                onChange={(e) => setTargetGrade(e.target.value ? parseFloat(e.target.value) : '')}
                min="0"
                max="100"
              />
              <span className="text-sm font-medium">%</span>
            </div>

            {displayStats.requiredGrade !== null && (
              <div className={`p-4 rounded-lg ${displayStats.requiredGrade > 100 ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
                <div className="text-sm font-medium mb-1">
                  {displayStats.requiredGrade > 100 ? 'Impossible!' : 'You need to average:'}
                </div>
                <div className="text-3xl font-bold">
                  {displayStats.requiredGrade > 100 ? '>100%' : `${displayStats.requiredGrade.toFixed(1)}%`}
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