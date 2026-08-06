import type { TreeDataProvider, TreeItem, EventEmitter, Disposable } from '@shared/types';
import i18n from 'i18next';

export class BacktestTreeDataProvider implements TreeDataProvider<any> {
  private _onDidChangeTreeData: EventEmitter<any | undefined> | undefined;

  constructor() {
    // EventEmitter would normally be provided by the host or a library
  }

  getTreeItem(element: any): TreeItem {
    return element;
  }

  async getChildren(element?: any): Promise<any[]> {
    if (!element) {
      // Root items
      return [
        {
          id: 'backtest.workflow',
          label: i18n.t('tree.backtestWorkflow', { ns: 'backtest' }),
          collapsibleState: 0, // None
          contextValue: 'workflow',
          command: {
            command: 'backtest.openWorkflow',
            title: i18n.t('tree.openWorkflow', { ns: 'backtest' }),
          }
        },
        {
          id: 'backtest.history-root',
          label: i18n.t('tree.history', { ns: 'backtest' }),
          collapsibleState: 1, // Collapsed
          contextValue: 'history-root',
        }
      ];
    }

    if (element.id === 'backtest.history-root') {
      // Return mock history items for now
      return [
        {
          id: 'result-1',
          label: i18n.t('tree.backtestResultN', { ns: 'backtest', n: 1 }),
          collapsibleState: 0,
          contextValue: 'result',
        },
        {
          id: 'result-2',
          label: i18n.t('tree.backtestResultN', { ns: 'backtest', n: 2 }),
          collapsibleState: 0,
          contextValue: 'result',
        }
      ];
    }

    return [];
  }

  refresh(): void {
    // Trigger refresh event
  }
}
