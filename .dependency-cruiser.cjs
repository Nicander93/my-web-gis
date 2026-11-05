/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'ui-panels-not-to-workbench',
      comment: '业务面板（ui/panels）不能反向依赖工作台外壳（ui/workbench）',
      severity: 'error',
      from: { path: '^apps/desktop/src/ui/panels/' },
      to: { path: '^apps/desktop/src/ui/workbench/' }
    },
    {
      name: 'ui-components-isolation',
      comment: '基础通用组件（ui/components）只能依赖自身、stores 或 platform，不认识具体工程与业务面板',
      severity: 'error',
      from: { path: '^apps/desktop/src/ui/components/' },
      to: {
        path: '^apps/desktop/src/(ui/(workbench|panels)|commands|engine-host|io|project)/'
      }
    },
    {
      name: 'non-ui-not-to-ui',
      comment: '命令、引擎宿主、IO、状态与工程层不能反向依赖 UI 层',
      severity: 'error',
      from: {
        path: '^apps/desktop/src/(commands|engine-host|io|stores|project|platform)/',
        pathNot: '\\.test\\.(ts|tsx)$'
      },
      to: { path: '^apps/desktop/src/ui/' }
    },
    {
      name: 'bridges-and-below-not-to-commands',
      comment: 'engine-host、io、stores、project、platform 不能反向调用 commands',
      severity: 'error',
      from: {
        path: '^apps/desktop/src/(engine-host|io|stores|project|platform)/',
        pathNot: '\\.test\\.(ts|tsx)$'
      },
      to: { path: '^apps/desktop/src/commands/' }
    },
    {
      name: 'io-not-to-engine-host',
      comment: 'io（导入导出与服务）与 engine-host 平级，不能依赖 engine-host',
      severity: 'error',
      from: {
        path: '^apps/desktop/src/io/',
        pathNot: '\\.test\\.(ts|tsx)$'
      },
      to: { path: '^apps/desktop/src/engine-host/' }
    },
    {
      name: 'stores-project-platform-not-to-bridges',
      comment: 'stores、project、platform 不能依赖 engine-host 或 io',
      severity: 'error',
      from: {
        path: '^apps/desktop/src/(stores|project|platform)/',
        pathNot: '\\.test\\.(ts|tsx)$'
      },
      to: { path: '^apps/desktop/src/(engine-host|io)/' }
    },
    {
      name: 'project-not-to-stores',
      comment: 'project（工程会话与数据集）不认识界面瞬态 stores',
      severity: 'error',
      from: {
        path: '^apps/desktop/src/project/',
        pathNot: '\\.test\\.(ts|tsx)$'
      },
      to: { path: '^apps/desktop/src/stores/' }
    },
    {
      name: 'datasets-only-to-platform',
      comment: 'project/datasets（要素 Provider/Buffer）不直接依赖外层 project 会话',
      severity: 'error',
      from: {
        path: '^apps/desktop/src/project/datasets/',
        pathNot: '\\.test\\.(ts|tsx)$'
      },
      to: {
        path: '^apps/desktop/src/project/',
        pathNot: '^apps/desktop/src/project/datasets/'
      }
    },
    {
      name: 'platform-leaf-layer',
      comment: 'platform 是最底层，不能依赖 Desktop 其它层',
      severity: 'error',
      from: {
        path: '^apps/desktop/src/platform/',
        pathNot: '\\.test\\.(ts|tsx)$'
      },
      to: {
        path: '^apps/desktop/src/(ui|commands|engine-host|io|stores|project)/'
      }
    },
    {
      name: 'packages-not-to-apps',
      comment: '任何 package 都不能依赖 apps/*',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' }
    },
    {
      name: 'public-packages-not-to-internal',
      comment: 'packages/public/* 只能依赖可发布包，不能依赖 packages/internal/*',
      severity: 'error',
      from: {
        path: '^packages/public/',
        pathNot: '\\.test\\.(ts|tsx)$'
      },
      to: { path: '^packages/internal/' }
    }
  ],
  options: {
    doNotFollow: {
      path: 'node_modules|dist|target|test-results'
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'apps/desktop/tsconfig.json'
    }
  }
}
