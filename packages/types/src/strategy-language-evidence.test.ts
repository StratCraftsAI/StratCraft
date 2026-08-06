/**
 * TICKET_661_1 AC-8 / AC-10 coverage for the authoritative language classifier.
 *
 * AC-8 names the shapes that MUST be covered explicitly:
 * - the code-only record with absent, empty, or non-JSON
 *   `classification_metadata` and no `file_path` (the section 3.1 bypass shape);
 * - a `.cpp`-named attachment containing Python;
 * - a DB `code` column disagreeing with its attachment.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyStrategyLanguageEvidence,
  STRATEGY_LANGUAGE_CLASSIFIER_VERSION,
} from './strategy-language-evidence';

const CPP_STRATEGY = `
#include <stratforge/strategy.hpp>
class MyStrategy final : public stratforge::Strategy {
 public:
  void on_bar() override {}
};
QNX_STRATEGY_FACTORY_EXPORT(MyStrategy)
`;

const PYTHON_STRATEGY = `
import backtrader as bt

class MyPyStrategy(bt.Strategy):
    def next(self):
        self.buy()
`;

describe('classifyStrategyLanguageEvidence', () => {
  describe('section 3.1 bypass shape: code-only record, no file_path', () => {
    it('resolves Python from DB code alone when classification_metadata is absent', () => {
      const result = classifyStrategyLanguageEvidence({ dbCode: PYTHON_STRATEGY });
      expect(result.language).toBe('python');
      expect(result.conflicts).toHaveLength(0);
    });

    it('resolves Python when classification_metadata is non-JSON (the replaced catch default)', () => {
      const result = classifyStrategyLanguageEvidence({
        dbCode: PYTHON_STRATEGY,
        classificationMetadata: 'not json at all {{{',
      });
      // The former `catch` block assigned C++ here. It must not.
      expect(result.language).toBe('python');
      expect(
        result.signals.find((s) => s.source === 'classification_metadata')?.detail,
      ).toContain('not valid JSON');
    });

    it('resolves Python when classification_metadata is an empty string', () => {
      const result = classifyStrategyLanguageEvidence({
        dbCode: PYTHON_STRATEGY,
        classificationMetadata: '   ',
      });
      expect(result.language).toBe('python');
      // Blank metadata contributes no signal at all.
      expect(result.signals.some((s) => s.source === 'classification_metadata')).toBe(false);
    });

    it('resolves C++ for a code-only C++ record', () => {
      const result = classifyStrategyLanguageEvidence({ dbCode: CPP_STRATEGY });
      expect(result.language).toBe('cpp');
    });
  });

  describe('conflict outranks priority', () => {
    it('is ambiguous when a .cpp attachment contains Python', () => {
      const result = classifyStrategyLanguageEvidence({
        filePath: '/strategies/thing.cpp',
        attachmentCode: PYTHON_STRATEGY,
        attachmentReadable: true,
      });
      // Strict priority would short-circuit on the .cpp extension and never
      // read the contradicting Python content.
      expect(result.language).toBe('ambiguous');
      expect(result.conflicts).toContainEqual({
        left: 'file_extension',
        leftLanguage: 'cpp',
        right: 'attachment_markers',
        rightLanguage: 'python',
      });
    });

    it('is ambiguous when a .py attachment contains C++', () => {
      const result = classifyStrategyLanguageEvidence({
        filePath: '/strategies/thing.py',
        attachmentCode: CPP_STRATEGY,
        attachmentReadable: true,
      });
      expect(result.language).toBe('ambiguous');
    });

    it('is ambiguous when the DB code column disagrees with the attachment', () => {
      const result = classifyStrategyLanguageEvidence({
        dbCode: PYTHON_STRATEGY,
        filePath: '/strategies/thing.cpp',
        attachmentCode: CPP_STRATEGY,
        attachmentReadable: true,
      });
      expect(result.language).toBe('ambiguous');
      expect(
        result.conflicts.some(
          (c) => c.left === 'attachment_markers' && c.right === 'db_code_markers',
        ),
      ).toBe(true);
    });

    it('is ambiguous when classification_metadata disagrees with the code body', () => {
      const result = classifyStrategyLanguageEvidence({
        dbCode: PYTHON_STRATEGY,
        classificationMetadata: JSON.stringify({ language: 'cpp' }),
      });
      expect(result.language).toBe('ambiguous');
    });

    it('is ambiguous when a single body carries both C++ and Python markers', () => {
      const mixed = `${CPP_STRATEGY}\n${PYTHON_STRATEGY}`;
      const result = classifyStrategyLanguageEvidence({ dbCode: mixed });
      // The body itself is contradictory, so it yields no confident language.
      expect(result.language).toBe('ambiguous');
      expect(
        result.signals.find((s) => s.source === 'db_code_markers')?.detail,
      ).toContain('mixed markers');
    });
  });

  describe('no usable signal is terminal ambiguous, never C++', () => {
    it('is ambiguous for entirely empty evidence', () => {
      const result = classifyStrategyLanguageEvidence({});
      expect(result.language).toBe('ambiguous');
      expect(result.signals).toHaveLength(0);
      expect(result.reason).toContain('No language evidence available');
    });

    it('is ambiguous for a body with no recognizable markers', () => {
      const result = classifyStrategyLanguageEvidence({ dbCode: 'x = 1 + 2' });
      expect(result.language).toBe('ambiguous');
    });

    it('is ambiguous for an unrecognized extension with an unreadable attachment', () => {
      const result = classifyStrategyLanguageEvidence({
        filePath: '/strategies/thing.bin',
        attachmentReadable: false,
      });
      expect(result.language).toBe('ambiguous');
      expect(result.missingAttachment).toBe(true);
    });
  });

  describe('missing attachment is an explicit finding', () => {
    it('flags missingAttachment when file_path is set but unreadable', () => {
      const result = classifyStrategyLanguageEvidence({
        dbCode: CPP_STRATEGY,
        filePath: '/gone/thing.cpp',
        attachmentReadable: false,
      });
      // The extension still agrees with the DB code, so the verdict stands,
      // but the missing attachment is reported rather than silently dropped.
      expect(result.language).toBe('cpp');
      expect(result.missingAttachment).toBe(true);
    });

    it('does not flag missingAttachment when there is no file_path', () => {
      const result = classifyStrategyLanguageEvidence({ dbCode: CPP_STRATEGY });
      expect(result.missingAttachment).toBe(false);
    });
  });

  describe('signal collection and priority among agreeing signals', () => {
    it('collects every available signal, not just the first', () => {
      const result = classifyStrategyLanguageEvidence({
        dbCode: CPP_STRATEGY,
        filePath: '/strategies/thing.cpp',
        attachmentCode: CPP_STRATEGY,
        attachmentReadable: true,
        classificationMetadata: JSON.stringify({ language: 'cpp' }),
        artifactKind: 'cpp',
      });
      expect(result.language).toBe('cpp');
      expect(result.signals.map((s) => s.source).sort()).toEqual([
        'artifact_kind',
        'attachment_markers',
        'classification_metadata',
        'db_code_markers',
        'file_extension',
      ]);
    });

    it('names the highest-priority source when all signals agree', () => {
      const result = classifyStrategyLanguageEvidence({
        dbCode: CPP_STRATEGY,
        artifactKind: 'cpp',
      });
      expect(result.reason).toContain('artifact_kind');
    });

    it('ignores an unrecognized artifact kind rather than guessing', () => {
      const result = classifyStrategyLanguageEvidence({
        dbCode: CPP_STRATEGY,
        artifactKind: 'rust',
      });
      expect(result.language).toBe('cpp');
      expect(
        result.signals.find((s) => s.source === 'artifact_kind')?.language,
      ).toBeNull();
    });

    it('records metadata that parses but carries no language field', () => {
      const result = classifyStrategyLanguageEvidence({
        dbCode: CPP_STRATEGY,
        classificationMetadata: JSON.stringify({ signalSource: 'builder' }),
      });
      expect(result.language).toBe('cpp');
      expect(
        result.signals.find((s) => s.source === 'classification_metadata')?.detail,
      ).toContain('no language field');
    });

    it('records metadata whose language value is unrecognized', () => {
      const result = classifyStrategyLanguageEvidence({
        dbCode: CPP_STRATEGY,
        classificationMetadata: JSON.stringify({ language: 'rust' }),
      });
      expect(result.language).toBe('cpp');
      expect(
        result.signals.find((s) => s.source === 'classification_metadata')?.language,
      ).toBeNull();
    });

    it('treats non-object JSON metadata as carrying no language', () => {
      const result = classifyStrategyLanguageEvidence({
        dbCode: CPP_STRATEGY,
        classificationMetadata: '42',
      });
      expect(result.language).toBe('cpp');
    });

    it('accepts alias spellings of the artifact kind', () => {
      expect(
        classifyStrategyLanguageEvidence({ artifactKind: 'c++' }).language,
      ).toBe('cpp');
      expect(
        classifyStrategyLanguageEvidence({ artifactKind: 'py' }).language,
      ).toBe('python');
    });

    it('skips the attachment signal when the attachment is blank', () => {
      const result = classifyStrategyLanguageEvidence({
        dbCode: CPP_STRATEGY,
        filePath: '/strategies/thing.cpp',
        attachmentCode: '   ',
        attachmentReadable: true,
      });
      expect(result.signals.some((s) => s.source === 'attachment_markers')).toBe(false);
      expect(result.language).toBe('cpp');
    });

    it('infers attachment readability from provided bytes when unspecified', () => {
      const result = classifyStrategyLanguageEvidence({
        filePath: '/strategies/thing.cpp',
        attachmentCode: CPP_STRATEGY,
      });
      expect(result.missingAttachment).toBe(false);
      expect(result.language).toBe('cpp');
    });

    it('recognizes .py, .cc, .hpp and other known extensions', () => {
      expect(
        classifyStrategyLanguageEvidence({ filePath: '/a/b.py' }).language,
      ).toBe('python');
      expect(
        classifyStrategyLanguageEvidence({ filePath: '/a/b.cc' }).language,
      ).toBe('cpp');
      expect(
        classifyStrategyLanguageEvidence({ filePath: '/a/b.hpp' }).language,
      ).toBe('cpp');
    });
  });

  it('stamps the classifier version on every result', () => {
    expect(classifyStrategyLanguageEvidence({}).classifierVersion).toBe(
      STRATEGY_LANGUAGE_CLASSIFIER_VERSION,
    );
  });
});
