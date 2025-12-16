import { describe, it, expect } from 'vitest';
import { MAIN_NAME } from '../src/const';

describe('Const', () => {
    it('should have correct MAIN_NAME', () => {
        expect(MAIN_NAME).toBe('jk-bms-card');
    });
});
