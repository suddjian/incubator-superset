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
/* eslint camelcase: 0 */
import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { bindActionCreators } from 'redux';
import { connect } from 'react-redux';
import { debounce } from 'lodash';
import styled from '@superset-ui/style';
import { t } from '@superset-ui/translation';
import { logging } from '@superset-ui/core';

import { useDynamicPluginContext } from 'src/components/DynamicPlugins/PluginContext';
import ExploreChartPanel from './ExploreChartPanel';
import ControlPanelsContainer from './ControlPanelsContainer';
import SaveModal from './SaveModal';
import QueryAndSaveBtns from './QueryAndSaveBtns';
import { getExploreLongUrl } from '../exploreUtils';
import { areObjectsEqual } from '../../reduxUtils';
import { getFormDataFromControls } from '../controlUtils';
import { chartPropShape } from '../../dashboard/util/propShapes';
import * as exploreActions from '../actions/exploreActions';
import * as saveModalActions from '../actions/saveModalActions';
import * as chartActions from '../../chart/chartAction';
import { fetchDatasourceMetadata } from '../../dashboard/actions/datasources';
import * as logActions from '../../logger/actions';
import {
  LOG_ACTIONS_MOUNT_EXPLORER,
  LOG_ACTIONS_CHANGE_EXPLORE_CONTROLS,
} from '../../logger/LogUtils';

const propTypes = {
  actions: PropTypes.object.isRequired,
  datasource_type: PropTypes.string.isRequired,
  isDatasourceMetaLoading: PropTypes.bool.isRequired,
  chart: chartPropShape.isRequired,
  slice: PropTypes.object,
  sliceName: PropTypes.string,
  controls: PropTypes.object.isRequired,
  forcedHeight: PropTypes.string,
  form_data: PropTypes.object.isRequired,
  standalone: PropTypes.bool.isRequired,
  timeout: PropTypes.number,
  impressionId: PropTypes.string,
  vizType: PropTypes.string,
};

const Styles = styled.div`
  height: ${({ height }) => height};
  min-height: ${({ height }) => height};
  overflow: hidden;
  text-align: left;
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: stretch;
  .control-pane {
    display: flex;
    flex-direction: column;
    padding: 0 ${({ theme }) => 2 * theme.gridUnit}px;
    max-height: 100%;
  }
`;

const getWindowSize = () => ({
  height: window.innerHeight,
  width: window.innerWidth,
});

function useWindowSize({ delayMs = 250 } = {}) {
  const [size, setSize] = useState(getWindowSize());

  useEffect(() => {
    const onWindowResize = debounce(() => setSize(getWindowSize()), delayMs);
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, []);

  return size;
}

/**
 * returns the value from the previous render.
 * @param {*} value the current value, which will be returned from usePrevious on the next render
 */
function usePrevious(value, initial = null) {
  const ref = useRef(initial);
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}

function ExploreViewContainer(props) {
  const dynamicPluginContext = useDynamicPluginContext();
  const dynamicPlugin = dynamicPluginContext.plugins[props.vizType];
  const isDynamicPluginLoading = dynamicPlugin && dynamicPlugin.loading;
  const wasDynamicPluginLoading = usePrevious(isDynamicPluginLoading);

  const previousControls = usePrevious(props.controls);
  const windowSize = useWindowSize();

  const [showingModal, setShowingModal] = useState(false);
  const [chartIsStale, setChartIsStale] = useState(false);

  const width = `${windowSize.width}px`;
  const navHeight = props.standalone ? 0 : 90;
  const height = props.forcedHeight
    ? `${props.forcedHeight}px`
    : `${windowSize.height - navHeight}px`;

  function addHistory({ isReplace = false, title } = {}) {
    const payload = { ...props.form_data };
    const longUrl = getExploreLongUrl(props.form_data, null, false);
    try {
      if (isReplace) {
        history.replaceState(payload, title, longUrl);
      } else {
        history.pushState(payload, title, longUrl);
      }
    } catch (e) {
      logging.warn(
        'Failed at altering browser history',
        payload,
        title,
        longUrl,
      );
    }
  }

  function handlePopstate() {
    const formData = history.state;
    if (formData && Object.keys(formData).length) {
      props.actions.setExploreControls(formData);
      props.actions.postChartFormData(
        formData,
        false,
        props.timeout,
        props.chart.id,
      );
    }
  }

  function onQuery() {
    // remove alerts when query
    props.actions.removeControlPanelAlert();
    props.actions.triggerQuery(true, props.chart.id);

    setChartIsStale(false);
    addHistory();
  }

  function handleKeydown(event) {
    const controlOrCommand = event.ctrlKey || event.metaKey;
    if (controlOrCommand) {
      const isEnter = event.key === 'Enter' || event.keyCode === 13;
      const isS = event.key === 's' || event.keyCode === 83;
      if (isEnter) {
        onQuery();
      } else if (isS) {
        if (props.slice) {
          props.actions
            .saveSlice(props.form_data, {
              action: 'overwrite',
              slice_id: props.slice.slice_id,
              slice_name: props.slice.slice_name,
              add_to_dash: 'noSave',
              goto_dash: false,
            })
            .then(({ data }) => {
              window.location = data.slice.slice_url;
            });
        }
      }
    }
  }

  function onStop() {
    if (props.chart && props.chart.queryController) {
      props.chart.queryController.abort();
    }
  }

  function toggleModal() {
    setShowingModal(!showingModal);
  }

  // effect to run on mount
  useEffect(() => {
    props.actions.logEvent(LOG_ACTIONS_MOUNT_EXPLORER);
    addHistory({ isReplace: true });
    window.addEventListener('popstate', handlePopstate);
    document.addEventListener('keydown', handleKeydown);
    return () => {
      window.removeEventListener('popstate', handlePopstate);
      document.removeEventListener('keydown', handleKeydown);
    };
  }, []);

  useEffect(() => {
    if (wasDynamicPluginLoading && !isDynamicPluginLoading) {
      // reload the controls now that we actually have the control config
      props.actions.dynamicPluginControlsReady();
    }
  }, [isDynamicPluginLoading]);

  // effect to run when controls change
  useEffect(() => {
    const hasError = Object.values(props.controls).some(
      control =>
        control.validationErrors && control.validationErrors.length > 0,
    );
    if (!hasError) {
      props.actions.triggerQuery(true, props.chart.id);
    }

    if (previousControls) {
      if (
        props.controls.datasource &&
        (previousControls.datasource == null ||
          props.controls.datasource.value !== previousControls.datasource.value)
      ) {
        // this should really be handled by actions
        fetchDatasourceMetadata(props.form_data.datasource, true);
      }

      const changedControlKeys = Object.keys(props.controls).filter(
        key =>
          typeof previousControls[key] !== 'undefined' &&
          !areObjectsEqual(
            props.controls[key].value,
            previousControls[key].value,
          ),
      );

      // this should also be handled by the actions that are actually changing the controls
      const hasDisplayControlChanged = changedControlKeys.some(
        key => props.controls[key].renderTrigger,
      );
      if (hasDisplayControlChanged) {
        props.actions.updateQueryFormData(
          getFormDataFromControls(props.controls),
          props.chart.id,
        );
        props.actions.renderTriggered(new Date().getTime(), props.chart.id);
        addHistory();
      }

      // this should be handled inside actions too
      const hasQueryControlChanged = changedControlKeys.some(
        key =>
          !props.controls[key].renderTrigger &&
          !props.controls[key].dontRefreshOnChange,
      );
      if (hasQueryControlChanged) {
        props.actions.logEvent(LOG_ACTIONS_CHANGE_EXPLORE_CONTROLS);
        setChartIsStale(true);
      }
    }
  }, [props.controls]);

  function renderErrorMessage() {
    // Returns an error message as a node if any errors are in the store
    const errors = [];
    for (const controlName in props.controls) {
      const control = props.controls[controlName];
      if (control.validationErrors && control.validationErrors.length > 0) {
        errors.push(
          <div key={controlName}>
            {t('Control labeled ')}
            <strong>{` "${control.label}" `}</strong>
            {control.validationErrors.join('. ')}
          </div>,
        );
      }
    }
    let errorMessage;
    if (errors.length > 0) {
      errorMessage = <div style={{ textAlign: 'left' }}>{errors}</div>;
    }
    return errorMessage;
  }

  function renderChartContainer() {
    return (
      <ExploreChartPanel
        width={width}
        height={height}
        {...props}
        errorMessage={renderErrorMessage()}
        refreshOverlayVisible={chartIsStale}
        addHistory={addHistory}
        onQuery={onQuery}
      />
    );
  }

  if (dynamicPluginContext.loading) {
    return 'loading...';
  }

  if (props.standalone) {
    return renderChartContainer();
  }

  return (
    <Styles id="explore-container" height={height}>
      {showingModal && (
        <SaveModal
          onHide={toggleModal}
          actions={props.actions}
          form_data={props.form_data}
          sliceName={props.sliceName}
        />
      )}
      <div className="col-sm-4 control-pane">
        <QueryAndSaveBtns
          canAdd={!!(props.can_add || props.can_overwrite)}
          onQuery={onQuery}
          onSave={toggleModal}
          onStop={onStop}
          loading={props.chart.chartStatus === 'loading'}
          chartIsStale={chartIsStale}
          errorMessage={renderErrorMessage()}
          datasourceType={props.datasource_type}
        />
        <ControlPanelsContainer
          actions={props.actions}
          form_data={props.form_data}
          controls={props.controls}
          datasource_type={props.datasource_type}
          isDatasourceMetaLoading={props.isDatasourceMetaLoading}
        />
      </div>
      <div className="col-sm-8">{renderChartContainer()}</div>
    </Styles>
  );
}

ExploreViewContainer.propTypes = propTypes;

function mapStateToProps(state) {
  const { explore, charts, impressionId } = state;
  const form_data = getFormDataFromControls(explore.controls);
  const chartKey = Object.keys(charts)[0];
  const chart = charts[chartKey];

  return {
    isDatasourceMetaLoading: explore.isDatasourceMetaLoading,
    datasource: explore.datasource,
    datasource_type: explore.datasource.type,
    datasourceId: explore.datasource_id,
    controls: explore.controls,
    can_overwrite: !!explore.can_overwrite,
    can_add: !!explore.can_add,
    can_download: !!explore.can_download,
    column_formats: explore.datasource
      ? explore.datasource.column_formats
      : null,
    containerId: explore.slice
      ? `slice-container-${explore.slice.slice_id}`
      : 'slice-container',
    isStarred: explore.isStarred,
    slice: explore.slice,
    sliceName: explore.sliceName,
    triggerRender: explore.triggerRender,
    form_data,
    table_name: form_data.datasource_name,
    vizType: form_data.viz_type,
    standalone: explore.standalone,
    forcedHeight: explore.forced_height,
    chart,
    timeout: explore.common.conf.SUPERSET_WEBSERVER_TIMEOUT,
    impressionId,
  };
}

function mapDispatchToProps(dispatch) {
  const actions = {
    ...exploreActions,
    ...saveModalActions,
    ...chartActions,
    ...logActions,
  };
  return {
    actions: bindActionCreators(actions, dispatch),
  };
}

export { ExploreViewContainer };

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(ExploreViewContainer);
