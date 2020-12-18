/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import React, { useEffect, useReducer } from 'react';
import { defineSharedModules, SupersetClient } from '@superset-ui/core';
import { FeatureFlag, isFeatureEnabled } from 'src/featureFlags';
import {
  dummyPluginContext,
  PluginContext,
  PluginContextType,
} from './PluginContext';

// the plugin returned from the API
type Plugin = {
  name: string;
  key: string;
  bundle_url: string;
  id: number;
};

type CompleteAction = {
  type: 'complete';
  key: string;
  error: null | Error;
};

type BeginAction = {
  type: 'begin';
  keys: string[];
};

function pluginContextReducer(
  state: PluginContextType,
  action: BeginAction | CompleteAction,
): PluginContextType {
  switch (action.type) {
    case 'begin': {
      const plugins = { ...state.plugins };
      action.keys.forEach(key => {
        plugins[key] = { key, error: null, loading: true };
      });
      return {
        ...state,
        loading: true,
        plugins,
      };
    }
    case 'complete': {
      return {
        ...state,
        loading: Object.values(state.plugins).some(
          plugin => plugin.loading && plugin.key !== action.key,
        ),
        plugins: {
          ...state.plugins,
          [action.key]: {
            key: action.key,
            loading: false,
            error: action.error,
          },
        },
      };
    }
    default:
      return state;
  }
}

export type Props = React.PropsWithChildren<{}>;

const sharedModules = {
  react: () => import('react'),
  lodash: () => import('lodash'),
  'react-dom': () => import('react-dom'),
  '@superset-ui/chart-controls': () => import('@superset-ui/chart-controls'),
  '@superset-ui/core': () => import('@superset-ui/core'),
};

export default function DynamicPluginProvider({ children }: Props) {
  const [pluginState, dispatch] = useReducer(pluginContextReducer, {
    // use the dummy plugin context, and override the methods
    ...dummyPluginContext,
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    fetchAll,
    loading: isFeatureEnabled(FeatureFlag.DYNAMIC_PLUGINS),
    // TODO: Write fetchByKeys
  });

  async function fetchAll() {
    try {
      await defineSharedModules(sharedModules);
      const response = await SupersetClient.get({
        endpoint: '/dynamic-plugins/api/read',
      });
      const plugins: Plugin[] = response.json.result;
      // const plugins: Plugin[] = [
      //   {
      //     name: 'Hello World',
      //     key: 'superset-chart-hello-world',
      //     id: 0,
      //     bundle_url: 'http://127.0.0.1:8080/main.js',
      //   },
      // ];
      dispatch({ type: 'begin', keys: plugins.map(plugin => plugin.key) });
      await Promise.all(
        plugins.map(async plugin => {
          let error: Error | null = null;
          try {
            await import(/* webpackIgnore: true */ plugin.bundle_url);
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error(
              `Failed to load plugin ${plugin.key} with the following error:`,
              err.stack,
            );
            error = err;
          }
          dispatch({
            type: 'complete',
            key: plugin.key,
            error,
          });
        }),
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(error.stack || error);
    }
  }

  useEffect(() => {
    if (isFeatureEnabled(FeatureFlag.DYNAMIC_PLUGINS)) {
      fetchAll();
    }
  }, []);

  return (
    <PluginContext.Provider value={pluginState}>
      {children}
    </PluginContext.Provider>
  );
}