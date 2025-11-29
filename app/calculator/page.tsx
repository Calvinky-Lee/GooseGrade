'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Calculator, GraduationCap, RotateCcw, GripVertical, Plus, Minus } from 'lucide-react';

interface Assessment {
  id: string;
  name: string;
  weight: number;
  weightInputValue?: string;
  grade?: number;
  inputValue?: string;
  isGroup?: false;
  order_index?: number;
}

interface GroupedAssessment {
  id: string;
  name: string;
  isGroup: true;
  children: Assessment[];
  totalWeight: number;
  groupGrade?: string;
}

type DisplayItem = Assessment | GroupedAssessment;

const DISTRIBUTE_EVENLY_ID = '__DISTRIBUTE_EVENLY__';

export default function CalculatorPage() {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [targetGrade, setTargetGrade] = useState<number | ''>('');
  const [invalidGrades, setInvalidGrades] = useState<Record<string, boolean>>({});
  
  // Drop Feature State
  const [dropMode, setDropMode] = useState<'none' | 'selectSource' | 'selectTarget'>('none');
  const [dropSourceId, setDropSourceId] = useState<string | null>(null);
  const [droppedMap, setDroppedMap] = useState<Record<string, string>>({});
  const [focusedId, setFocusedId] = useState<string | null>(null);
  
  // Remove Feature State
  const [removeMode, setRemoveMode] = useState(false);
  const [removedItems, setRemovedItems] = useState<Set<string>>(new Set());
  
  // Grouping state
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [groupGrades, setGroupGrades] = useState<Record<string, string>>({});
  
  // Display stats
  const [displayStats, setDisplayStats] = useState<{
    currentGrade: number;
    requiredGrade: number | null;
    totalProgress: number;
  }>({ currentGrade: 0, requiredGrade: null, totalProgress: 0 });
  
  // Drag and Drop State
  const [draggedItem, setDraggedItem] = useState<{ id: string; isGroup: boolean; groupId?: string } | null>(null);
  const [dragOverItem, setDragOverItem] = useState<{ id: string; isGroup: boolean; groupId?: string; position?: 'before' | 'after' } | null>(null);

  // Helper to group assessments (copied from course page)
  const groupAssessments = (flatAssessments: Assessment[]): DisplayItem[] => {
    const groups: Record<string, Assessment[]> = {};
    const singles: Assessment[] = [];
    const processedIds = new Set<string>();

    const pluralize = (name: string) => {
      let cleanName = name.replace(/^[""'"]+|[""'"]+$/g, '').trim();
      if (cleanName.toLowerCase().endsWith('quiz')) return cleanName + 'zes';
      if (cleanName.toLowerCase().endsWith('s')) return cleanName;
      return cleanName + 's';
    };

    flatAssessments.forEach(a => {
      const match = a.name.match(/^(.*?) ?#?\d+/);
      if (match) {
        const baseName = match[1].trim();
        if (baseName) {
          if (!groups[baseName]) groups[baseName] = [];
          groups[baseName].push(a);
        }
      }
    });

    Object.entries(groups).forEach(([baseName, items]) => {
      if (items.length > 1) {
        items.forEach(a => processedIds.add(a.id));
      } else {
        processedIds.delete(items[0].id);
      }
    });

    flatAssessments.forEach(a => {
      if (!processedIds.has(a.id)) {
        singles.push(a);
      }
    });

    const result: DisplayItem[] = [];
    
    Object.entries(groups).forEach(([baseName, items]) => {
      if (items.length > 1) {
        items.sort((a, b) => {
          const numA = parseInt(a.name.match(/\d+/)?.[0] || '0');
          const numB = parseInt(b.name.match(/\d+/)?.[0] || '0');
          return numA - numB;
        });
        
        const totalWeight = items.reduce((sum, a) => sum + a.weight, 0);
        result.push({
          id: baseName,
          name: pluralize(baseName),
          isGroup: true,
          children: items,
          totalWeight
        });
      }
    });
    
    singles.forEach(a => result.push(a));
    
    return result;
  };

  // Weight adjustments
  const weightAdjustments: Record<string, number> = {};
  Object.entries(droppedMap).forEach(([sourceId, targetId]) => {
    if (targetId === DISTRIBUTE_EVENLY_ID) {
      const source = assessments.find(a => a.id === sourceId);
      if (!source) return;
      const sourceWeight = source.weight + (weightAdjustments[sourceId] || 0);
      
      const displayItems = groupAssessments(assessments);
      const allOtherItems: DisplayItem[] = [];
      displayItems.forEach(item => {
        if (droppedMap[item.id] || item.id === sourceId || removedItems.has(item.id)) return;
        if (item.isGroup) {
          item.children.forEach(child => {
            if (!droppedMap[child.id] && child.id !== sourceId && !removedItems.has(child.id)) {
              allOtherItems.push(child);
            }
          });
        } else {
          allOtherItems.push(item);
        }
      });
      
      if (allOtherItems.length > 0) {
        const perItem = sourceWeight / allOtherItems.length;
        allOtherItems.forEach(item => {
          if (!item.isGroup) {
            weightAdjustments[item.id] = (weightAdjustments[item.id] || 0) + perItem;
          }
        });
      }
    } else {
      const source = assessments.find(a => a.id === sourceId);
      if (!source) return;
      const sourceWeight = source.weight + (weightAdjustments[sourceId] || 0);
      weightAdjustments[targetId] = (weightAdjustments[targetId] || 0) + sourceWeight;
    }
  });

  // Drop handlers
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
      if (droppedMap[itemId]) return;
      setDropSourceId(itemId);
      setDropMode('selectTarget');
    } else if (dropMode === 'selectTarget') {
      if (itemId === dropSourceId || droppedMap[itemId]) return;
      
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

      if (sourceGroupId && targetGroupId && sourceGroupId === targetGroupId) {
        const isChildToParent = !sourceGroupObj && targetGroupObj;
        if (!isChildToParent) {
          alert("Cannot transfer weight to specific items within the same section. To redistribute weight among remaining items, select the Section Header.");
          return;
        }
      }

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

  const getEffectiveWeight = (item: DisplayItem) => {
    if (item.isGroup) {
      let activeChildrenSum = 0;
      item.children.forEach(child => {
        if (!droppedMap[child.id]) activeChildrenSum += child.weight;
      });
      const groupAdjustment = weightAdjustments[item.id] || 0;
      return activeChildrenSum + groupAdjustment;
    } else {
      const adjustment = weightAdjustments[item.id] || 0;
      return item.weight + adjustment;
    }
  };

  const getDistributedChildWeight = (child: Assessment, group: GroupedAssessment) => {
    if (droppedMap[child.id]) return 0;
    let weight = child.weight;
    weight += (weightAdjustments[child.id] || 0);
    const groupAdjustment = weightAdjustments[group.id] || 0;
    if (groupAdjustment !== 0) {
      const activeChildrenCount = group.children.filter(c => !droppedMap[c.id]).length;
      if (activeChildrenCount > 0) {
        weight += groupAdjustment / activeChildrenCount;
      }
    }
    return weight;
  };

  // Calculation functions (copied from course page)
  const calculateCurrentGrade = () => {
    let totalWeight = 0;
    let earnedWeight = 0;
    const displayItems = groupAssessments(assessments);

    displayItems.forEach(item => {
      if (droppedMap[item.id] || removedItems.has(item.id)) return;

      if (item.isGroup) {
        const isExpanded = expandedGroups.has(item.id);
        if (isExpanded) {
          item.children.forEach(child => {
            if (removedItems.has(child.id)) return;
            const effWeight = getDistributedChildWeight(child, item);
            if (effWeight > 0 && child.grade !== undefined && child.grade !== null && !isNaN(child.grade)) {
              totalWeight += effWeight;
              earnedWeight += (child.grade / 100) * effWeight;
            }
          });
        } else {
          const effGroupWeight = getEffectiveWeight(item);
          const gVal = groupGrades[item.id];
          const gNum = parseFloat(gVal || '');
          if (gVal && !isNaN(gNum)) {
            totalWeight += effGroupWeight;
            earnedWeight += (gNum / 100) * effGroupWeight;
          }
        }
      } else {
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
      if (droppedMap[item.id] || removedItems.has(item.id)) return;

      if (item.isGroup) {
        const isExpanded = expandedGroups.has(item.id);
        if (isExpanded) {
          item.children.forEach(child => {
            if (removedItems.has(child.id)) return;
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
      if (droppedMap[item.id] || removedItems.has(item.id)) return;
      if (item.isGroup) {
        if (expandedGroups.has(item.id)) {
          item.children.forEach(c => {
            if (removedItems.has(c.id)) return;
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

  // Drag handlers (simplified)
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

  const handleDrop = (e: React.DragEvent, targetItem: DisplayItem, targetGroupId?: string) => {
    e.preventDefault();
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
      const insertIndex = dragOverItem?.position === 'before' ? targetIndex : targetIndex + 1;
      newChildren.splice(insertIndex > sourceIndex ? insertIndex - 1 : insertIndex, 0, removed);
      itemsToReorder[groupIndex] = {
        ...group,
        children: newChildren
      };
    } else {
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
        setDraggedItem(null);
        return;
      }
      const [removed] = itemsToReorder.splice(sourceIndex, 1);
      const insertIndex = dragOverItem?.position === 'before' ? targetIndex : targetIndex + 1;
      itemsToReorder.splice(insertIndex > sourceIndex ? insertIndex - 1 : insertIndex, 0, removed);
    }
    
    const reorderedAssessments: Assessment[] = [];
    itemsToReorder.forEach((item) => {
      if (item.isGroup) {
        item.children.forEach((child) => {
          const existingAssessment = assessments.find(a => a.id === child.id);
          if (existingAssessment) {
            reorderedAssessments.push(existingAssessment);
          }
        });
      } else {
        const existingAssessment = assessments.find(a => a.id === item.id);
        if (existingAssessment) {
          reorderedAssessments.push(existingAssessment);
        }
      }
    });
    
    setAssessments(reorderedAssessments);
    setDraggedItem(null);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverItem(null);
  };

  // Add/Remove handlers
  const handleAddAssessment = () => {
    const newId = `new-${Date.now()}`;
    const newAssessment: Assessment = {
      id: newId,
      name: 'New Assessment',
      weight: 0,
      weightInputValue: '0',
      grade: undefined,
      inputValue: '',
      order_index: assessments.length * 100
    };
    setAssessments([...assessments, newAssessment]);
  };

  const handleRemoveAssessment = (itemId: string, isGroup: boolean) => {
    const newRemoved = new Set(removedItems);
    if (isGroup) {
      const displayItems = groupAssessments(assessments);
      const group = displayItems.find(g => g.isGroup && g.id === itemId);
      if (group && group.isGroup) {
        newRemoved.add(itemId);
        group.children.forEach(child => newRemoved.add(child.id));
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

  const hasRemovedOriginalItems = Array.from(removedItems).some(id => !id.startsWith('new-'));

  return (
    <div className="relative min-h-screen overflow-hidden bg-white font-sans text-black">
      <div className="max-w-4xl mx-auto pb-20 pt-12 sm:pt-16 px-6">
        <header className="mb-8">
          <h1 className="text-3xl font-bold">New Calculator</h1>
        </header>

        <div className="grid md:grid-cols-3 gap-8">
          <div className="md:col-span-2 space-y-6">
            <div className="bg-card border rounded-xl shadow-sm overflow-hidden">
              <div className="bg-muted/30 px-6 py-4 border-b flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <h3 className="font-semibold flex items-center">
                    <Calculator className="w-4 h-4 mr-2" /> Assessments
                  </h3>
                  {dropMode === 'selectTarget' && (
                    <button 
                      onClick={handleDistributeEvenly}
                      disabled={hasRemovedOriginalItems}
                      className={`text-xs px-3 py-1.5 rounded-full transition-colors font-medium ${
                        hasRemovedOriginalItems
                          ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                          : 'bg-primary text-primary-foreground hover:bg-primary/90'
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
                    const adjustment = weightAdjustments[item.id] || 0;
                    
                    let internalAdjustment = 0;
                    item.children.forEach(child => {
                      if (droppedMap[child.id] === item.id) {
                        internalAdjustment += child.weight + (weightAdjustments[child.id] || 0);
                      }
                    });
                    
                    const displayAdjustment = adjustment - internalAdjustment;
                    const childrenSum = item.children.reduce((sum, child) => {
                      if (droppedMap[child.id]) return sum;
                      return sum + getDistributedChildWeight(child, item);
                    }, 0);
                    const displayedTotalWeight = childrenSum;
                    
                    const isDragging = draggedItem?.id === item.id && !draggedItem.groupId;
                    const isDragOver = dragOverItem?.id === item.id && !dragOverItem.groupId;
                    
                    return (
                      <div key={item.id} className="bg-white">
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

                          <GripVertical className="w-4 h-4 text-gray-400 cursor-grab active:cursor-grabbing" />
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleGroup(item.id);
                            }}
                            className="p-1 hover:bg-gray-100 rounded-md transition-colors disabled:opacity-50"
                          >
                            {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
                          </button>
                          
                          <div className="flex-1 cursor-pointer" onClick={(e) => {
                            if (dropMode === 'none') toggleGroup(item.id);
                          }}>
                            <div className={`font-medium ${isDropped ? 'line-through' : ''}`}>
                              {item.name.replace(/^[""'"]+|[""'"]+$/g, '').trim()}
                              {isDropped && <span className="ml-2 text-xs text-red-500 no-underline">(Dropped)</span>}
                            </div>
                            <div className="text-sm text-muted-foreground flex items-center gap-2">
                              <span>{item.children.filter(c => !droppedMap[c.id] && !removedItems.has(c.id)).length} items</span>
                              <span>•</span>
                              <span>
                                Total {Math.abs(displayedTotalWeight - Math.round(displayedTotalWeight)) < 0.01 ? Math.round(displayedTotalWeight) : Number(displayedTotalWeight).toFixed(5).replace(/\.?0+$/, '')}%&nbsp;weight
                              </span>
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
                        {isDragOver && dragOverItem?.position === 'after' && (
                          <div className="h-0.5 bg-blue-500 ml-3 mr-6" />
                        )}
                        {isExpanded && (
                          <div className="bg-gray-50/50 border-t border-gray-100 divide-y divide-gray-100/50">
                            {item.children.filter(child => !removedItems.has(child.id)).map((child) => {
                              const isChildDropped = !!droppedMap[child.id];
                              const isChildSource = dropSourceId === child.id;
                              const isChildTargetCandidate = dropMode === 'selectTarget' && !isChildDropped && !isChildSource && !isDropped;
                              const isChildSourceCandidate = dropMode === 'selectSource' && !isChildDropped && !isDropped;
                              const isChildInvalid = !!invalidGrades[child.id];
                              
                              const childRowClasses = `pl-14 pr-6 py-3 flex items-center gap-2 transition-all relative ${
                                isChildDropped ? 'opacity-50 bg-gray-100' :
                                removeMode ? 'hover:bg-red-50 cursor-pointer hover:border-l-4 hover:border-red-500' :
                                isChildSource ? 'bg-red-50 border-l-4 border-red-500' :
                                isChildTargetCandidate ? 'hover:bg-green-50 cursor-pointer hover:border-l-4 hover:border-green-500' :
                                isChildSourceCandidate ? 'hover:bg-red-50 cursor-pointer hover:border-l-4 hover:border-red-500' :
                                ''
                              }`;
                              
                              const distributedWeight = getDistributedChildWeight(child, item);
                              const isChildDragging = draggedItem?.id === child.id && draggedItem.groupId === item.id;
                              const isChildDragOver = dragOverItem?.id === child.id && dragOverItem.groupId === item.id;

                              return (
                                <div key={`child-wrapper-${child.id}`}>
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

                                    <GripVertical className="w-4 h-4 text-gray-400 cursor-grab active:cursor-grabbing" />
                                    <div className="flex-1">
                                      <div className={`text-sm font-medium text-gray-700 ${isChildDropped ? 'line-through' : ''}`}>
                                        {child.name}
                                        {isChildDropped && <span className="ml-2 text-xs text-red-500 no-underline">(Dropped)</span>}
                                      </div>
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
                                  {isChildDragOver && dragOverItem?.position === 'after' && (
                                    <div className="h-0.5 bg-blue-500 mx-6 ml-14" />
                                  )}
                                </div>
                              );
                            })}
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

                          <GripVertical className="w-4 h-4 text-gray-400 cursor-grab active:cursor-grabbing" />
                          <div className="flex-1 ml-6">
                            <div className={`font-medium ${isDropped ? 'line-through' : ''}`}>
                              {assessment.name.replace(/^[""'"]+|[""'"]+$/g, '').trim()}
                              {isDropped && <span className="ml-2 text-xs text-red-500 no-underline">(Dropped)</span>}
                            </div>
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
                        {isDragOver && dragOverItem?.position === 'after' && (
                          <div className="h-0.5 bg-blue-500 ml-3 mr-6" />
                        )}
                      </div>
                    );
                  }
                })}
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
    </div>
  );
}

