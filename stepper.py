import time
import RPi.GPIO as GPIO

DIR_FORWARD = GPIO.HIGH
DIR_REVERSE = GPIO.LOW
ENABLE_ACTIVE = GPIO.LOW
ENABLE_INACTIVE = GPIO.HIGH


class A4988Stepper:
    def __init__(
        self,
        step_pin,
        dir_pin,
        enable_pin=None,
        pulse_us=1000,
        gap_us=1000,
        *,
        auto_disable=True,
        cleanup_release_enable=False,
        enable_delay_s=0.002,
        dir_setup_s=0.001,
        start_gap_us=5000,
        ramp_steps=50,
        settle_after_move_s=0.05,
    ):
        self.step_pin = step_pin
        self.dir_pin = dir_pin
        self.enable_pin = enable_pin
        self.pulse_s = pulse_us / 1_000_000.0
        self.gap_s = gap_us / 1_000_000.0
        self.auto_disable = auto_disable
        self.cleanup_release_enable = cleanup_release_enable
        self.enable_delay_s = enable_delay_s
        self.dir_setup_s = dir_setup_s
        self.start_gap_s = start_gap_us / 1_000_000.0
        self.ramp_steps = int(ramp_steps)
        self.settle_after_move_s = settle_after_move_s
        self._cleaned_up = False

        GPIO.setmode(GPIO.BCM)
        GPIO.setwarnings(False)
        GPIO.setup(step_pin, GPIO.OUT, initial=GPIO.LOW)
        GPIO.setup(dir_pin, GPIO.OUT, initial=DIR_FORWARD)
        if enable_pin is not None:
            GPIO.setup(enable_pin, GPIO.OUT, initial=ENABLE_INACTIVE)

    def enable(self):
        if self.enable_pin is not None:
            GPIO.output(self.enable_pin, ENABLE_ACTIVE)
            time.sleep(self.enable_delay_s)

    def disable(self):
        if self.enable_pin is not None:
            GPIO.output(self.enable_pin, ENABLE_INACTIVE)
        GPIO.output(self.step_pin, GPIO.LOW)

    def move(self, steps, forward=True):
        if self._cleaned_up:
            raise RuntimeError("Stepper has already been cleaned up")

        steps = int(steps)
        if steps <= 0:
            return

        # Keep STEP low before changing DIR/enabling the driver. A floating or
        # already-high STEP line can be interpreted as an unintended pulse.
        GPIO.output(self.step_pin, GPIO.LOW)
        GPIO.output(self.dir_pin, DIR_FORWARD if forward else DIR_REVERSE)
        time.sleep(self.dir_setup_s)

        try:
            self.enable()
            for _ in range(steps):
                gap_s = self._gap_for_step(_)
                GPIO.output(self.step_pin, GPIO.HIGH)
                time.sleep(self.pulse_s)
                GPIO.output(self.step_pin, GPIO.LOW)
                time.sleep(gap_s)
        finally:
            GPIO.output(self.step_pin, GPIO.LOW)
            time.sleep(self.settle_after_move_s)
            if self.auto_disable:
                self.disable()

    def _gap_for_step(self, step_index):
        """
        Start each move slowly, then ramp to the requested speed.

        A stepper often buzzes instead of rotating when commanded to start at a
        speed that is fine once already moving but too fast from rest. This is
        especially common with Python GPIO timing, marginal current limiting,
        heavier loads, or microstepping.
        """
        if self.ramp_steps <= 0 or self.start_gap_s <= self.gap_s:
            return self.gap_s

        ramp_index = min(step_index, self.ramp_steps)
        progress = ramp_index / self.ramp_steps
        return self.start_gap_s - ((self.start_gap_s - self.gap_s) * progress)

    def cleanup(self):
        if self._cleaned_up:
            return

        # Put the driver in a safe idle state first. Do not release ENABLE by
        # default: GPIO.cleanup(enable_pin) turns the pin back into a floating
        # input, and a floating A4988 ENABLE pin can re-enable the driver and
        # make the motor buzz/spin after this process exits.
        self.disable()
        time.sleep(0.001)

        pins_to_release = [self.step_pin, self.dir_pin]
        if self.enable_pin is not None and self.cleanup_release_enable:
            pins_to_release.append(self.enable_pin)

        GPIO.cleanup(pins_to_release)
        self._cleaned_up = True
