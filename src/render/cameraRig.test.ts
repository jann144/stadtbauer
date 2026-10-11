import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CAMERA, WORLD } from '../config/settings';
import { CameraRig } from './cameraRig';

function onScreen(rig: CameraRig, point: Vector3): Vector3 {
  return point.clone().project(rig.camera);
}

describe('CameraRig', () => {
  it('trifft in der Bildmitte den Zielpunkt', () => {
    const rig = new CameraRig();
    const hit = rig.groundAt(0, 0)!;
    expect(hit.x).toBeCloseTo(rig.target.x, 3);
    expect(hit.z).toBeCloseTo(rig.target.z, 3);
  });

  it('hält beim Verschieben den gegriffenen Bodenpunkt unter dem Zeiger', () => {
    const rig = new CameraRig();
    const grabbed = rig.groundAt(0.2, -0.3)!.clone();
    rig.panGrab(0.2, -0.3, -0.1, 0.1);
    const screen = onScreen(rig, grabbed);
    expect(screen.x).toBeCloseTo(-0.1, 3);
    expect(screen.y).toBeCloseTo(0.1, 3);
  });

  it('hält beim Zoomen den Bodenpunkt unter dem Zeiger', () => {
    const rig = new CameraRig();
    const pinned = rig.groundAt(0.4, 0.2)!.clone();
    rig.zoomAt(0.4, 0.2, 1.5);
    expect(rig.distance).toBeCloseTo(CAMERA.startDistance / 1.5, 6);
    const screen = onScreen(rig, pinned);
    expect(screen.x).toBeCloseTo(0.4, 3);
    expect(screen.y).toBeCloseTo(0.2, 3);
  });

  it('hält beim Drehen den Bodenpunkt unter den Fingern', () => {
    const rig = new CameraRig();
    const pinned = rig.groundAt(-0.3, -0.2)!.clone();
    rig.twistAt(-0.3, -0.2, 0.4);
    const screen = onScreen(rig, pinned);
    expect(screen.x).toBeCloseTo(-0.3, 3);
    expect(screen.y).toBeCloseTo(-0.2, 3);
  });

  it('dreht die Karte bei positivem Winkel im Uhrzeigersinn', () => {
    const rig = new CameraRig();
    const rightOfCenter = rig.groundAt(0.5, 0)!.clone();
    rig.twistAt(0, 0, 0.2);
    // Im Uhrzeigersinn wandert ein Punkt rechts der Mitte nach unten.
    expect(onScreen(rig, rightOfCenter).y).toBeLessThan(0);
  });

  it('begrenzt Abstand und Neigung', () => {
    const rig = new CameraRig();
    rig.zoomAt(0, 0, 1e6);
    expect(rig.distance).toBe(CAMERA.minDistance);
    rig.zoomAt(0, 0, 1e-6);
    expect(rig.distance).toBe(CAMERA.maxDistance);
    rig.orbit(0, 10);
    expect(rig.pitch).toBe(CAMERA.maxPitch);
    rig.orbit(0, -10);
    expect(rig.pitch).toBe(CAMERA.minPitch);
  });

  it('stellt einen gespeicherten Blick wieder her und fängt unmögliche Werte ein', () => {
    const rig = new CameraRig();
    rig.panBy(120, -80);
    rig.orbit(0.7, 0.2);
    rig.zoomAt(0, 0, 2);
    const copy = new CameraRig();
    copy.setPose(rig.pose);
    expect(copy.pose).toEqual(rig.pose);
    expect(copy.camera.position.distanceTo(rig.camera.position)).toBeCloseTo(0, 6);

    copy.setPose({ x: 1e9, z: -1e9, distance: 0, yaw: 0, pitch: 9 });
    expect(copy.target.x).toBe(WORLD.size / 2);
    expect(copy.target.z).toBe(-WORLD.size / 2);
    expect(copy.distance).toBe(CAMERA.minDistance);
    expect(copy.pitch).toBe(CAMERA.maxPitch);
  });

  it('bewegt sich mit der Tastatur relativ zur Blickrichtung', () => {
    const rig = new CameraRig();
    const ahead = rig.groundAt(0, 0.5)!.clone();
    const before = rig.target.distanceTo(ahead);
    rig.panBy(0, 10);
    expect(rig.target.distanceTo(ahead)).toBeLessThan(before);
  });

  it('hält den Zielpunkt auf der Karte', () => {
    const rig = new CameraRig();
    rig.panBy(1e6, 1e6);
    expect(Math.abs(rig.target.x)).toBeLessThanOrEqual(WORLD.size / 2);
    expect(Math.abs(rig.target.z)).toBeLessThanOrEqual(WORLD.size / 2);
  });
});
