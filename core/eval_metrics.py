"""Stage 2 and bonus metrics computed from prediction lists."""

from __future__ import annotations

from qc_metrics import temporal_iou


def accuracy(y_true: list[str], y_pred: list[str]) -> float:
    if len(y_true) != len(y_pred) or not y_true:
        return 0.0
    correct = sum(left == right for left, right in zip(y_true, y_pred))
    return correct / len(y_true)


def confusion_matrix(y_true: list[str], y_pred: list[str], labels: list[str]) -> list[list[int]]:
    index = {label: position for position, label in enumerate(labels)}
    matrix = [[0 for _ in labels] for _ in labels]
    for truth, predicted in zip(y_true, y_pred):
        if truth not in index or predicted not in index:
            continue
        matrix[index[truth]][index[predicted]] += 1
    return matrix


def macro_f1(y_true: list[str], y_pred: list[str], labels: list[str]) -> float:
    if not labels:
        return 0.0
    matrix = confusion_matrix(y_true, y_pred, labels)
    scores: list[float] = []
    for position, _label in enumerate(labels):
        true_positive = matrix[position][position]
        predicted_positive = sum(row[position] for row in matrix)
        actual_positive = sum(matrix[position])
        precision = true_positive / predicted_positive if predicted_positive else 0.0
        recall = true_positive / actual_positive if actual_positive else 0.0
        if precision + recall == 0:
            scores.append(0.0)
        else:
            scores.append(2 * precision * recall / (precision + recall))
    return sum(scores) / len(scores)


def mean_temporal_iou(pairs: list[tuple[float, float, float, float]]) -> float:
    if not pairs:
        return 0.0
    total = 0.0
    for pred_start, pred_end, gt_start, gt_end in pairs:
        total += temporal_iou(pred_start, pred_end, gt_start, gt_end)
    return total / len(pairs)


def recall_at_1(pairs: list[tuple[float, float, float, float]], threshold: float) -> float:
    if not pairs:
        return 0.0
    hits = 0
    for pred_start, pred_end, gt_start, gt_end in pairs:
        if temporal_iou(pred_start, pred_end, gt_start, gt_end) >= threshold:
            hits += 1
    return hits / len(pairs)
