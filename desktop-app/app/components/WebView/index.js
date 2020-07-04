// @flow
import React, {Component, createRef} from 'react';
import { remote } from 'electron';
import cx from 'classnames';
import { Resizable } from 're-resizable';
import {Tooltip} from '@material-ui/core';
import debounce from 'lodash.debounce';
import pubsub from 'pubsub.js';
import BugIcon from '../icons/Bug';
import ScreenshotIcon from '../icons/Screenshot';
import DeviceRotateIcon from '../icons/DeviceRotate';
import {iconsColor} from '../../constants/colors';
import {
  SCROLL_DOWN,
  SCROLL_UP,
  NAVIGATION_BACK,
  NAVIGATION_FORWARD,
  NAVIGATION_RELOAD,
  SCREENSHOT_ALL_DEVICES,
  FLIP_ORIENTATION_ALL_DEVICES,
  ENABLE_INSPECTOR_ALL_DEVICES,
  DISABLE_INSPECTOR_ALL_DEVICES,
  RELOAD_CSS,
  DELETE_STORAGE,
} from '../../constants/pubsubEvents';
import {CAPABILITIES} from '../../constants/devices';

import styles from './style.module.css';
import commonStyles from '../common.styles.css';
import UnplugIcon from '../icons/Unplug';
import {captureFullPage} from './screenshotUtil';

const BrowserWindow = remote.BrowserWindow;

const MESSAGE_TYPES = {
  scroll: 'scroll',
  click: 'click',
  openDevToolsInspector: 'openDevToolsInspector',
  disableInspector: 'disableInspector',
  openConsole: 'openConsole',
  tiltDevice: 'tiltDevice',
  takeScreenshot: 'takeScreenshot',
  toggleEventMirroring: 'toggleEventMirroring',
};

class WebView extends Component {
  constructor(props) {
    super(props);
    this.webviewRef = createRef();
    this.state = {
      screenshotInProgress: false,
      isTilted: false,
      isUnplugged: false,
      errorCode: null,
      errorDesc: null,
      deviceDimensions : {
        width: this.props.device.width,
        height: this.props.device.height
      },
      temporaryDims: null
    };
    this.subscriptions = [];
  }

  componentDidMount() {
    //this.initDeviceEmulationParams();
    this.webviewRef.current.addEventListener(
      'ipc-message',
      this.messageHandler
    );
    this.subscriptions.push(
      pubsub.subscribe('scroll', this.processScrollEvent)
    );
    this.subscriptions.push(pubsub.subscribe('click', this.processClickEvent));
    this.subscriptions.push(
      pubsub.subscribe(SCROLL_DOWN, this.processScrollDownEvent)
    );
    this.subscriptions.push(
      pubsub.subscribe(SCROLL_UP, this.processScrollUpEvent)
    );
    this.subscriptions.push(
      pubsub.subscribe(NAVIGATION_BACK, this.processNavigationBackEvent)
    );
    this.subscriptions.push(
      pubsub.subscribe(NAVIGATION_FORWARD, this.processNavigationForwardEvent)
    );
    this.subscriptions.push(
      pubsub.subscribe(NAVIGATION_RELOAD, this.processNavigationReloadEvent)
    );
    this.subscriptions.push(
      pubsub.subscribe(RELOAD_CSS, this.processReloadCSSEvent)
    );
    this.subscriptions.push(
      pubsub.subscribe(DELETE_STORAGE, this.processDeleteStorageEvent)
    );
    this.subscriptions.push(
      pubsub.subscribe(SCREENSHOT_ALL_DEVICES, this.processScreenshotEvent)
    );
    this.subscriptions.push(
      pubsub.subscribe(
        FLIP_ORIENTATION_ALL_DEVICES,
        this.processFlipOrientationEvent
      )
    );
    this.subscriptions.push(
      pubsub.subscribe(
        ENABLE_INSPECTOR_ALL_DEVICES,
        this.processEnableInspectorEvent
      )
    );
    this.subscriptions.push(
      pubsub.subscribe(
        DISABLE_INSPECTOR_ALL_DEVICES,
        this.processDisableInspectorEvent
      )
    );

    this.webviewRef.current.addEventListener('dom-ready', () => {
      this.initEventTriggers(this.webviewRef.current);
    });

    this.webviewRef.current.addEventListener('did-start-loading', () => {
      this.setState({errorCode: null, errorDesc: null});
      this.props.onLoadingStateChange(true);
    });
    this.webviewRef.current.addEventListener('did-stop-loading', () => {
      this.props.onLoadingStateChange(false);
    });
    this.webviewRef.current.addEventListener(
      'did-fail-load',
      ({errorCode, errorDescription}) => {
        if (errorCode === -3) {
          //Aborted error, can be ignored
          return;
        }
        this.setState({
          errorCode: errorCode,
          errorDesc: errorDescription,
        });
      }
    );

    this.webviewRef.current.addEventListener(
      'login',
      (event, request, authInfo, callback) => {
        event.preventDefault();
        callback('username', 'secret');
      }
    );

    const urlChangeHandler = ({url}) => {
      if (url === this.props.browser.address) {
        return;
      }
      this.props.onAddressChange(url);
    };

    this.webviewRef.current.addEventListener('will-navigate', urlChangeHandler);

    this.webviewRef.current.addEventListener(
      'did-navigate-in-page',
      urlChangeHandler
    );

    this.webviewRef.current.addEventListener('did-navigate', ({url}) => {
      if (this.props.transmitNavigatorStatus) {
        this.props.updateNavigatorStatus({
          backEnabled: this.webviewRef.current.canGoBack(),
          forwardEnabled: this.webviewRef.current.canGoForward(),
        });
      }
    });

    this.webviewRef.current.addEventListener('devtools-opened', () => {
      /*this.webviewRef.current
        .getWebContents()
        .devToolsWebContents.executeJavaScript(
          'DevToolsAPI.enterInspectElementMode()'
        );*/
    });
  }

  getWebContents() {
    return this.getWebContentForId(this.webviewRef.current.getWebContentsId());
  }

  getWebContentForId(id) {
    return remote.webContents.fromId(id);
  }

  componentWillUnmount() {
    this.subscriptions.forEach(pubsub.unsubscribe);
  }

  initDeviceEmulationParams = () => {
    try {
      return;
      this.getWebContents().enableDeviceEmulation({
        screenPosition: this.isMobile ? 'mobile' : 'desktop',
        screenSize: {
          width: this.props.device.width,
          height: this.props.device.height,
        },
        deviceScaleFactor: this.props.device.dpr,
      });
    } catch (err) {
      console.log('err', err);
    }
  };

  processNavigationBackEvent = () => {
    this.webviewRef.current.goBack();
  };

  processNavigationForwardEvent = () => {
    this.webviewRef.current.goForward();
  };

  processNavigationReloadEvent = ({ignoreCache}) => {
    if (ignoreCache) {
      return this.webviewRef.current.reloadIgnoringCache();
    }
    this.webviewRef.current.reload();
  };

  processReloadCSSEvent = () => {
    this.webviewRef.current.executeJavaScript(`
        var elements = document.querySelectorAll('link[rel=stylesheet][href]');
        elements.forEach(element=>{
          var href = element.href;
          if(href){
            var href = href.replace(/[?&]invalidateCacheParam=([^&$]*)/,'');
            element.href = href + (href.indexOf('?')>=0?'&':'?') + 'invalidateCacheParam=' + (new Date().valueOf());
          }
        })
    `);
  };

  processDeleteStorageEvent = ({storages}) => {
    this.getWebContents().session.clearStorageData({storages});
  };

  processScrollEvent = message => {
    if (
      this.state.isUnplugged ||
      message.sourceDeviceId === this.props.device.id
    ) {
      return;
    }
    this.webviewRef.current.send('scrollMessage', message.position);
  };

  processClickEvent = message => {
    if (
      this.state.isUnplugged ||
      message.sourceDeviceId === this.props.device.id
    ) {
      return;
    }
    this.webviewRef.current.send('clickMessage', message);
  };

  processScrollDownEvent = message => {
    if (this.state.isUnplugged) {
      return;
    }
    this.webviewRef.current.send('scrollDownMessage');
  };

  processScrollUpEvent = message => {
    if (this.state.isUnplugged) {
      return;
    }
    this.webviewRef.current.send('scrollUpMessage');
  };

  processScreenshotEvent = async ({now}) => {
    this.setState({screenshotInProgress: true});
    await captureFullPage(
      this.props.browser.address,
      this.props.device,
      this.webviewRef.current,
      now != null,
      now
    );
    this.setState({screenshotInProgress: false});
  };

  processFlipOrientationEvent = () => {
    if (!this.isMobile) {
      return;
    }
    this._flipOrientation();
  };

  processOpenDevToolsInspectorEvent = message => {
    const {
      x: webViewX,
      y: webViewY,
    } = this.webviewRef.current.getBoundingClientRect();
    const {x: deviceX, y: deviceY} = message;
    const zoomFactor = this.props.browser.zoomLevel;
    this.getWebContents().inspectElement(
      Math.round(webViewX + deviceX * zoomFactor),
      Math.round(webViewY + deviceY * zoomFactor)
    );
  };

  processEnableInspectorEvent = () => {
    this.webviewRef.current.send('enableInspectorMessage');
  };

  processDisableInspectorEvent = message => {
    if (message.sourceDeviceId === this.props.device.id) {
      return;
    }
    this.webviewRef.current.send('disableInspectorMessage');
  };

  messageHandler = ({channel: type, args: [message]}) => {
    if (type !== MESSAGE_TYPES.toggleEventMirroring && this.state.isUnplugged) {
      return;
    }
    switch (type) {
      case MESSAGE_TYPES.scroll:
        pubsub.publish('scroll', [message]);
        return;
      case MESSAGE_TYPES.click:
        pubsub.publish('click', [message]);
        return;
      case MESSAGE_TYPES.openDevToolsInspector:
        this.processOpenDevToolsInspectorEvent(message);
        return;
      case MESSAGE_TYPES.disableInspector:
        this.transmitDisableInspectorToAllDevices(message);
        return;
      case MESSAGE_TYPES.openConsole:
        this._toggleDevTools();
        return;
      case MESSAGE_TYPES.tiltDevice:
        this._flipOrientation();
        return;
      case MESSAGE_TYPES.takeScreenshot:
        this.processScreenshotEvent({});
        return;
      case MESSAGE_TYPES.toggleEventMirroring:
        this._unPlug();
        break;
      default: break;
    }
  };

  transmitDisableInspectorToAllDevices = message => {
    pubsub.publish(DISABLE_INSPECTOR_ALL_DEVICES, [message]);
  };

  initEventTriggers = webview => {
    this.getWebContentForId(webview.getWebContentsId()).executeJavaScript(`
      responsivelyApp.deviceId = ${this.props.device.id};
      document.body.addEventListener('mouseleave', () => {
        window.responsivelyApp.mouseOn = false;
        if (responsivelyApp.domInspectorEnabled) {
          responsivelyApp.domInspector.disable();
        }
      });
      document.body.addEventListener('mouseenter', () => {
        responsivelyApp.mouseOn = true;
        if (responsivelyApp.domInspectorEnabled) {
          responsivelyApp.domInspector.enable();
        }
      });

      window.addEventListener('scroll', (e) => {
        if (!responsivelyApp.mouseOn) {
          return;
        }
        window.responsivelyApp.sendMessageToHost(
          '${MESSAGE_TYPES.scroll}',
          {
            position: {x: window.scrollX, y: window.scrollY},
          }
        );
      });

      document.addEventListener(
        'click', 
        (e) => {
          if (e.target === window.responsivelyApp.lastClickElement || e.responsivelyAppProcessed) {
            window.responsivelyApp.lastClickElement = null;
            e.responsivelyAppProcessed = true;
            return;
          } 
          if (window.responsivelyApp.domInspectorEnabled) {
            e.preventDefault();
            window.responsivelyApp.domInspector.disable();
            window.responsivelyApp.domInspectorEnabled = false;
            const targetRect = e.target.getBoundingClientRect();
            window.responsivelyApp.sendMessageToHost(
              '${MESSAGE_TYPES.disableInspector}'
            );
            window.responsivelyApp.sendMessageToHost(
              '${MESSAGE_TYPES.openDevToolsInspector}',
              {x: targetRect.left, y: targetRect.top}
            );
            return;
          }
          e.responsivelyAppProcessed = true;
          window.responsivelyApp.sendMessageToHost(
            '${MESSAGE_TYPES.click}', 
            {
              cssPath: window.responsivelyApp.cssPath(e.target),
            }
          );
        },
        true
      );
    `);
  };

  _toggleDevTools = () => {
    /*const devtools = new BrowserWindow({
      fullscreen: false,
      acceptFirstMouse: true,
      show: true,
    });
    //devtools.hide();

    this.webviewRef.current
      .getWebContents()
      .setDevToolsWebContents(devtools.webContents);
    this.getWebContents().openDevTools({mode: 'detach'});*/
    this.getWebContents().toggleDevTools();
  };

  _flipOrientation = () => {
    this.setState({isTilted: !this.state.isTilted});
  };

  _unPlug = () => {
    this.setState({isUnplugged: !this.state.isUnplugged}, () => {
      this.webviewRef.current.send(
        'eventsMirroringState',
        !this.state.isUnplugged
      );
    });
  };

  get isMobile() {
    return this.props.device.capabilities.indexOf(CAPABILITIES.mobile) > -1;
  }

  _setResizeDimensions  = (event, direction, ref, delta) => {
    const { temporaryDims } = this.state;
      if(!temporaryDims) return;
      const updatedDeviceDims = {
        width: temporaryDims.width + delta.width,
        height: temporaryDims.height + delta.height
      };
      this.setState({
        deviceDimensions: updatedDeviceDims
      });
  }

  _getWebViewTag = (deviceStyles) => {
    const {device : { id, useragent, capabilities }, browser : { address }} = this.props;
    const { deviceDimensions } = this.state;

    if(capabilities.includes(CAPABILITIES.responsive)){
      const responsiveStyle = {
        width: deviceDimensions.width,
        height:  deviceDimensions.height
      }
      return (
        <Resizable 
          className={cx(styles.resizableView)}
          size={{width: responsiveStyle.width, height: responsiveStyle.height}}
          onResizeStart={() => {
            const updatedTempDims = {
              width: deviceDimensions.width,
              height: deviceDimensions.height
            }
            this.setState({
              temporaryDims: updatedTempDims
            });
          }}
          onResize={debounce(this._setResizeDimensions, 25, { maxWait: 50 })}
          onResizeStop={() =>{
            this.setState({
              temporaryDims: null
            });
          }}
          handleComponent={
            {
              right:  <div className={cx(styles.iconWrapper, styles.iconWrapperE)} {...this.props}><div className={styles.iconHolder} /></div>,
              bottom : <div className={cx(styles.iconWrapper, styles.iconWrapperS)} {...this.props}><div className={styles.iconHolder} /></div>,
              bottomRight : <div className={cx(styles.iconWrapper, styles.iconWrapperSE)} {...this.props}><div className={styles.iconHolder} /></div>,
            }
          }
        >
          <webview
            ref={this.webviewRef}
            preload="./preload.js"
            className={cx(styles.device)}
            src={address || 'about:blank'}
            useragent={useragent}
            style={responsiveStyle}
          />
        </Resizable>
      )
    }

    return (
      <webview
        ref={this.webviewRef}
        preload="./preload.js"
        className={cx(styles.device)}
        src={address || 'about:blank'}
        useragent={useragent}
        style={deviceStyles}
      />
    );
  }

  render() {
    const { browser : { zoomLevel } } = this.props;
    const { isTilted, deviceDimensions, errorCode, errorDesc, screenshotInProgress } = this.state;
    const deviceStyles = {
      width:
        this.isMobile && isTilted ? deviceDimensions.height : deviceDimensions.width,
      height:
        this.isMobile && isTilted ? deviceDimensions.width : deviceDimensions.height,
    };

    return (
      <div
        className={cx(styles.webViewContainer)}
        style={{
          width: deviceStyles.width * zoomLevel,
          height: deviceStyles.height * zoomLevel + 40
        }} 
      >
        <div className={cx(styles.webViewToolbar)}>
          <Tooltip title="Open DevTools">
            <div
              className={cx(
                styles.webViewToolbarIcons,
                commonStyles.icons,
                commonStyles.enabled
              )}
              onClick={this._toggleDevTools}
            >
              <BugIcon width={20} color={iconsColor} />
            </div>
          </Tooltip>
          <Tooltip title="Take Screenshot">
            <div
              className={cx(
                styles.webViewToolbarIcons,
                commonStyles.icons,
                commonStyles.enabled
              )}
              onClick={() => this.processScreenshotEvent({})}
            >
              <ScreenshotIcon height={18} color={iconsColor} />
            </div>
          </Tooltip>
          <Tooltip title="Tilt Device">
            <div
              className={cx(styles.webViewToolbarIcons, commonStyles.icons, {
                [commonStyles.enabled]: this.isMobile,
                [commonStyles.disabled]: !this.isMobile,
                [commonStyles.selected]: this.state.isTilted,
              })}
              onClick={this._flipOrientation}
            >
              <DeviceRotateIcon height={17} color={iconsColor} />
            </div>
          </Tooltip>
          <Tooltip title="Disable event mirroring">
            <div
              className={cx(
                styles.webViewToolbarIcons,
                commonStyles.icons,
                commonStyles.enabled,
                {
                  [commonStyles.selected]: this.state.isUnplugged,
                }
              )}
              onClick={this._unPlug}
            >
              <UnplugIcon height={30} color={iconsColor} />
            </div>
          </Tooltip>
        </div>
        <div
          className={cx(styles.deviceContainer)}
          style={{
             width: deviceStyles.width,
            transform: `scale(${zoomLevel})`, 
          }}
        >
          <div
            className={cx(styles.deviceOverlay, {
              [styles.overlayEnabled]: screenshotInProgress,
            })}
            style={deviceStyles}
          />
          <div
            className={cx(styles.deviceOverlay, {
              [styles.overlayEnabled]: errorCode,
            })}
            style={deviceStyles}
          >
            <p>ERROR: {errorCode}</p>
            <p className={cx(styles.errorDesc)}>{errorDesc}</p>
          </div>
          {this._getWebViewTag(deviceStyles)}
        </div>
      </div>
    );
  }
}

export default WebView;
