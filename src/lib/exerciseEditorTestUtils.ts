/**
 * Test utilities for EditableExerciseRow + useExerciseEditor + update-exercise flow
 * 
 * Run these tests manually by editing exercises in the UI and checking console logs
 */

import { Exercise } from '@/hooks/useExerciseEditor';

export interface TestCase {
  id: string;
  description: string;
  input: Partial<Exercise>;
  expectedPayload: Exercise;
  expectedToBlock: boolean;
  expectedToastVariant: 'success' | 'error';
  expectedToastMessage: string;
}

export const TEST_CASES: TestCase[] = [
  {
    id: 'valid-update',
    description: '✅ Valid Update - All fields properly formatted',
    input: {
      name: 'Bench Press',
      sets: 3,
      reps: '10-12',
      weight: '60kg',
    },
    expectedPayload: {
      name: 'Bench Press',
      sets: 3,
      reps: '10-12',
      weight: '60kg',
    },
    expectedToBlock: false,
    expectedToastVariant: 'success',
    expectedToastMessage: 'Exercise updated',
  },
  {
    id: 'empty-sets-sanitization',
    description: '✅ Empty Sets Field - Should sanitize to 1',
    input: {
      name: 'Squat',
      sets: '' as any, // User leaves field empty
      reps: '8-10',
    },
    expectedPayload: {
      name: 'Squat',
      sets: 1, // Sanitized to 1
      reps: '8-10',
    },
    expectedToBlock: false,
    expectedToastVariant: 'success',
    expectedToastMessage: 'Exercise updated',
  },
  {
    id: 'whitespace-trimming',
    description: '✅ Whitespace Trimming - All fields should be trimmed',
    input: {
      name: '  Deadlift  ',
      sets: 5,
      reps: ' 5-7  ',
      weight: '  100kg ',
      rest: '  90s  ',
      description: '  Focus on form  ',
    },
    expectedPayload: {
      name: 'Deadlift',
      sets: 5,
      reps: '5-7',
      weight: '100kg',
      rest: '90s',
      description: 'Focus on form',
    },
    expectedToBlock: false,
    expectedToastVariant: 'success',
    expectedToastMessage: 'Exercise updated',
  },
  {
    id: 'invalid-sets-zero',
    description: '❌ Invalid Sets (0) - Should block before API call',
    input: {
      name: 'Pull-ups',
      sets: 0,
      reps: '10',
    },
    expectedPayload: {} as any, // No payload sent
    expectedToBlock: true,
    expectedToastVariant: 'error',
    expectedToastMessage: 'Sets must be at least 1',
  },
  {
    id: 'invalid-empty-reps',
    description: '❌ Invalid Empty Reps - Should block before API call',
    input: {
      name: 'Push-ups',
      sets: 3,
      reps: '',
    },
    expectedPayload: {} as any, // No payload sent
    expectedToBlock: true,
    expectedToastVariant: 'error',
    expectedToastMessage: 'Reps are required',
  },
  {
    id: 'nan-sets-sanitization',
    description: '✅ NaN Sets - Should sanitize to 1',
    input: {
      name: 'Lunges',
      sets: NaN,
      reps: '12-15',
    },
    expectedPayload: {
      name: 'Lunges',
      sets: 1, // Sanitized to 1
      reps: '12-15',
    },
    expectedToBlock: false,
    expectedToastVariant: 'success',
    expectedToastMessage: 'Exercise updated',
  },
];

/**
 * Validates the payload structure before sending to edge function
 */
export function validatePayloadStructure(payload: any): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (typeof payload.sets !== 'number') {
    errors.push(`sets must be number, received: ${typeof payload.sets}`);
  }

  if (isNaN(payload.sets)) {
    errors.push('sets is NaN');
  }

  if (typeof payload.name !== 'string') {
    errors.push(`name must be string, received: ${typeof payload.name}`);
  }

  if (payload.name.trim() !== payload.name) {
    errors.push('name has leading/trailing whitespace');
  }

  if (typeof payload.reps !== 'string') {
    errors.push(`reps must be string, received: ${typeof payload.reps}`);
  }

  if (payload.reps.trim() !== payload.reps) {
    errors.push('reps has leading/trailing whitespace');
  }

  if (payload.weight && typeof payload.weight !== 'string') {
    errors.push(`weight must be string, received: ${typeof payload.weight}`);
  }

  if (payload.weight && payload.weight.trim() !== payload.weight) {
    errors.push('weight has leading/trailing whitespace');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Logs test case results to console
 */
export function logTestResult(testCase: TestCase, actualResult: {
  payload?: any;
  blocked: boolean;
  toastVariant?: 'success' | 'error';
  toastMessage?: string;
  validationErrors?: string[];
}) {
  console.group(`🧪 Test: ${testCase.id}`);
  console.log(`📝 Description: ${testCase.description}`);
  console.log(`📥 Input:`, testCase.input);
  
  if (actualResult.blocked) {
    console.log(`🚫 BLOCKED by frontend validation`);
    console.log(`Expected: ${testCase.expectedToBlock ? '✅ Should block' : '❌ Should NOT block'}`);
  } else {
    console.log(`✅ Payload sent to edge function:`, actualResult.payload);
    
    const validation = validatePayloadStructure(actualResult.payload);
    if (!validation.valid) {
      console.error(`❌ Payload validation FAILED:`, validation.errors);
    } else {
      console.log(`✅ Payload structure is valid`);
    }
    
    // Compare with expected
    const matches = JSON.stringify(actualResult.payload) === JSON.stringify(testCase.expectedPayload);
    console.log(`Expected payload: ${matches ? '✅ Matches' : '❌ Mismatch'}`);
    if (!matches) {
      console.log(`Expected:`, testCase.expectedPayload);
      console.log(`Actual:`, actualResult.payload);
    }
  }
  
  if (actualResult.toastMessage) {
    console.log(`💬 Toast: [${actualResult.toastVariant}] "${actualResult.toastMessage}"`);
    const toastMatches = 
      actualResult.toastVariant === testCase.expectedToastVariant &&
      actualResult.toastMessage.includes(testCase.expectedToastMessage);
    console.log(`Expected toast: ${toastMatches ? '✅ Matches' : '❌ Mismatch'}`);
  }
  
  console.groupEnd();
}

/**
 * Print all test cases for manual testing
 */
export function printTestInstructions() {
  console.log('🧪 Exercise Editor Test Suite');
  console.log('============================\n');
  console.log('To run these tests manually:');
  console.log('1. Navigate to the workout view');
  console.log('2. Click "Edit" on any exercise');
  console.log('3. Enter the test input values below');
  console.log('4. Check the console for validation results\n');
  
  TEST_CASES.forEach((testCase, index) => {
    console.group(`Test ${index + 1}: ${testCase.description}`);
    console.log('Input values:');
    Object.entries(testCase.input).forEach(([key, value]) => {
      console.log(`  ${key}: ${JSON.stringify(value)}`);
    });
    console.log(`Expected outcome: ${testCase.expectedToBlock ? 'BLOCKED' : 'SUCCESS'}`);
    console.groupEnd();
  });
}
