import React from 'react';
import {Composition} from 'remotion';
import './fonts';   // carga fuentes premium (Anton/Oswald/Bebas/Archivo/Barlow/Playfair)
import {PipelineMotion, PipelineMotionProps} from './video';
import {GeoMap, GeoMapEvent} from './geomap';
import {VidrushReferenceStudy, VIDRUSH_STUDY_FRAMES} from './vidrush-study';

// Demo del motor de mapa vectorial (Israel→Irán→Estrecho de Ormuz, como la referencia Vox).
const GEO_DEMO: GeoMapEvent = {
  duration: 9,
  highlight: [
    {name: 'Israel', color: '#2f6fed', flag: 'flag_il.png'},
    {name: 'Iran', color: '#e0362f', flag: 'flag_ir.png'},
  ],
  route: {fromLon: 34.9, fromLat: 31.5, toLon: 53.7, toLat: 32.4, color: '#ff4438', strike: true, jets: 3},
  markers: [{lon: 56.4, lat: 26.6, label: 'Estrecho de Ormuz', color: '#ffcf4d'}],
  locName: 'Irán · Estrecho de Ormuz',
};
const GeoDemoRoot: React.FC<{event: GeoMapEvent}> = ({event}) => <GeoMap event={event} />;

const defaultProps: PipelineMotionProps = {
  videoSrc: 'demo_footage.mp4',
  width: 1920,
  height: 1080,
  fps: 30,
  durationSeconds: 8,
  style: 'low',
  events: [
    {
      id: 'intro',
      type: 'title_full',
      start: 0.3,
      duration: 3.5,
      title: 'Motion graphics',
      subtitle: 'Local, sincronizado y sin IA',
      accent: '#2f80ff',
    },
  ],
};

export const Root: React.FC = () => {
  return (
    <>
    <Composition
      id="GeoMapDemo"
      component={GeoDemoRoot}
      durationInFrames={Math.ceil((GEO_DEMO.duration || 9) * 30)}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{event: GEO_DEMO}}
    />
    <Composition
      id="PipelineMotion"
      component={PipelineMotion}
      durationInFrames={Math.max(1, Math.ceil(defaultProps.durationSeconds * defaultProps.fps))}
      fps={defaultProps.fps}
      width={defaultProps.width}
      height={defaultProps.height}
      defaultProps={defaultProps}
      calculateMetadata={({props}) => {
        const p = props as PipelineMotionProps;
        const fps = p.fps || 30;
        const width = p.width || 1920;
        const height = p.height || 1080;
        return {
          fps,
          width,
          height,
          durationInFrames: Math.max(1, Math.ceil((p.durationSeconds || 8) * fps)),
        };
      }}
    />
    <Composition
      id="VidrushReferenceStudy"
      component={VidrushReferenceStudy}
      durationInFrames={VIDRUSH_STUDY_FRAMES}
      fps={30}
      width={1280}
      height={720}
    />
    </>
  );
};
