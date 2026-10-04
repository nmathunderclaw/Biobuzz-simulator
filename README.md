<p align="center">
  <img src="assets/logo.png" alt="NMA Thunder Claw logo" width="200"/>
</p>

<p align="center">
  <img src="assets/banner.svg" alt="NMA Thunder Claw - FTC Team 32807" width="640"/>
</p>

<div align="center">

<a href="https://thunderclaw.vercel.app">
  <strong>OPEN BIOBUZZ SIMULATOR</strong>
</a>

</div>

---

# BIOBUZZ Sim 3D (FTC 2026–2027)

A 3D simulation of the FTC BIOBUZZ match: the field is built from FIRST's official CAD file, with 300 Hz ball/HIVE physics, custom-designed robots, programmable AUTO strategies, AprilTag auto-aim, AI bots, an automatic referee, replay + match analysis, bloom graphics, and two-player online play.

## Quick start

Open `index.html` in Chrome/Edge (an internet connection is required to load three.js r128 from cdnjs and Google Fonts).

Online play only works when the page is opened inside Claude (it uses the artifact `room` feature).

## Controls

- By default the robot is driven with a **gamepad** (Xbox, PlayStation, Logitech F310 in X mode). The keyboard is still used for shortcuts (C switches the view, Esc pauses, Delete resets the field in practice mode, etc.).
- To drive with the keyboard: Settings → Controls → "Drive robot with keyboard". Keys ramp up gradually like an analog stick, and turning runs at 60% power (adjustable). Turn off your Vietnamese input method (Unikey/EVKey) when driving with the keyboard, otherwise W A S D get swallowed; the page shows a reminder when it detects one.
- Camera: left-drag to rotate, Shift + drag or right-drag to pan, scroll to zoom, double-click to reset; each view remembers its own camera. Gamepad: pause → "Adjust this camera".

## AUTO strategy

The **AUTO Strategy** menu lets you draw a 30-second program on the field, viewed from the RED driver station (the BLUE side is automatically rotated 180°).

Available steps:

- Go to
- Shoot (in place / find a spot)
- Pick up balls inside a circle
- Turn
- Wait
- Wait until second
- PARK

"Test run" runs the program with the real engine (a single robot on the field) and logs the result of each step; "Shot map" highlights the standing positions from which shots score.

Choose a program for yourself and for your bot teammate on the Match / Two players / Online screens; share programs with a `BBA1.…` code.

The model and program runner live in `ai.js` (`AI.PLAN`, `runPlan`), and the UI is in `autoed.js`.

## Building from source

```bash
node build.mjs        # bundles src/ into dist/index.html
