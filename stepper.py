import time
import RPi.GPIO as GPIO

DIR_FORWARD = GPIO.HIGH
DIR_REVERSE = GPIO.LOW
ENABLE_ACTIVE = GPIO.LOW
ENABLE_INACTIVE = GPIO.HIGH


class A4988Stepper:
    def __init__(self, step_pin, dir_pin, enable_pin=None, pulse_us=500, gap_us=500):
        self.step_pin = step_pin
        self.dir_pin = dir_pin
        self.enable_pin = enable_pin
        self.pulse_s = pulse_us / 1_000_000.0
        self.gap_s = gap_us / 1_000_000.0

        GPIO.setmode(GPIO.BCM)
        GPIO.setup(step_pin, GPIO.OUT, initial=GPIO.LOW)
        GPIO.setup(dir_pin, GPIO.OUT, initial=DIR_FORWARD)
        if enable_pin is not None:
            GPIO.setup(enable_pin, GPIO.OUT, initial=ENABLE_INACTIVE)

    def enable(self):
        if self.enable_pin is not None:
            GPIO.output(self.enable_pin, ENABLE_ACTIVE)

    def disable(self):
        if self.enable_pin is not None:
            GPIO.output(self.enable_pin, ENABLE_INACTIVE)

    def move(self, steps, forward=True):
        GPIO.output(self.dir_pin, DIR_FORWARD if forward else DIR_REVERSE)
        time.sleep(0.00001)

        self.enable()
        for _ in range(steps):
            GPIO.output(self.step_pin, GPIO.HIGH)
            time.sleep(self.pulse_s)
            GPIO.output(self.step_pin, GPIO.LOW)
            time.sleep(self.gap_s)

    def cleanup(self):
        self.disable()
        GPIO.cleanup()