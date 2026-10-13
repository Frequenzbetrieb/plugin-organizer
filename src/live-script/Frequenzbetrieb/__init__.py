# Frequenzbetrieb Plugin Organizer – Live control surface script.
# Select "Frequenzbetrieb" as Control Surface in Live's settings (Link, Tempo & MIDI); input/output can stay "None".
from .organizer import Organizer


def create_instance(c_instance):
    return Organizer(c_instance)
