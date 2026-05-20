import { Injectable, Mod, terra } from '@project-selene/api';
import { Game } from '@project-selene/api/terra';

class Jetpack extends Injectable(Game) {
    update() {
        if (terra.g_input.bindings.actions.get('dash').isActive()) {
            terra.g_player.entity.actor.doJump(10, 10, 10);
        }
        return super.update();
    }
}

export default function main(mod: Mod) {
    mod.inject(Jetpack);
}