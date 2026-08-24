"""The bounded label propagation behind themes.

Graphiti's own implementation loops until a full pass changes nothing, and on
some graphs boundary nodes trade communities forever — caught live as a test
hang whose stack pointed at the candidate-count line. The vendored version caps
the rounds. These tests pin the two behaviors that matter: a graph that never
converges upstream still terminates here, and one that does converge reaches
the regions you would expect.
"""

from tlon.graph.communities import MAX_PROPAGATION_ROUNDS, _label_propagation


class Neighbor:
    def __init__(self, node_uuid: str, edge_count: int = 1):
        self.node_uuid = node_uuid
        self.edge_count = edge_count


def projection_for(nodes: list[str], edges: list[tuple[str, str]]):
    proj = {node: [] for node in nodes}
    for a, b in edges:
        proj[a].append(Neighbor(b))
        proj[b].append(Neighbor(a))
    return proj


def clusters_of(partition: list[list[str]]) -> set[frozenset[str]]:
    return {frozenset(cluster) for cluster in partition}


def test_an_oscillating_graph_cannot_stall_clustering():
    # Found by search over small connected graphs: on this shape the upstream
    # algorithm's no_change condition never fires, checked to a thousand rounds.
    # Every node sits in a triangle except 4 and 5, and the boundary keeps
    # flipping them between neighbouring communities forever. The cap is the
    # only thing standing between this graph and a mining run that never ends.
    nodes = [str(i) for i in range(6)]
    edges = [
        ("0", "1"),
        ("0", "2"),
        ("0", "3"),
        ("1", "2"),
        ("1", "3"),
        ("3", "4"),
        ("4", "5"),
    ]
    proj = projection_for(nodes, edges)

    partition = _label_propagation(proj)

    covered = [node for cluster in partition for node in cluster]
    assert sorted(covered) == sorted(nodes), "every node lands in exactly one region"


def test_a_converging_graph_finds_the_regions_you_would_expect():
    # Two triangles joined by a single bridge. Propagation settles with each
    # triangle as one region — the answer any round cap above a handful gives,
    # so the cap changes nothing on graphs that behave.
    nodes = [str(i) for i in range(6)]
    edges = [
        ("0", "1"),
        ("1", "2"),
        ("0", "2"),  # first triangle
        ("3", "4"),
        ("4", "5"),
        ("3", "5"),  # second triangle
        ("2", "3"),  # the bridge
    ]
    proj = projection_for(nodes, edges)

    partition = _label_propagation(proj)

    assert clusters_of(partition) == {
        frozenset({"0", "1", "2"}),
        frozenset({"3", "4", "5"}),
    }


def test_the_cap_is_a_real_number_not_a_promise():
    # A regression guard against the cap being loosened back into `while True`:
    # the constant must exist and stay small enough that even the worst case
    # finishes inside a normal request budget.
    assert isinstance(MAX_PROPAGATION_ROUNDS, int)
    assert 0 < MAX_PROPAGATION_ROUNDS <= 1000
